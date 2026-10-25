// @vitest-environment happy-dom

/**
 * The peer UI of a parked Node tab wired to the real `exportThisTabBackup` (the real `LocalWriter`, `openWebExportWriter` and
 * alert module), with a download stream that stops taking writes. This proves what the page does when the export is
 * cancelled, not what a browser does with the download.
 *
 * Labels: (R) reproducer, fails on the code before the Cancel existed because the dialog on screen at the stall has no
 * `onCancel`; (N) new behaviour.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const world = vi.hoisted(() => ({
    db: {} as unknown,
    files: new Map<string, Uint8Array>(),
    confirm: [] as string[],
    confirmAnswer: true,
    /** Writes after the first `stallAfter` never settle until `releases` run. */
    stallAfter: Number.POSITIVE_INFINITY,
    writes: [] as Uint8Array[],
    closes: 0,
    aborts: 0,
    created: 0,
    releases: [] as Array<() => void>,
    helperAnswers: true,
    closeStalls: false,
    notices: [] as string[],
    collectGate: null as Promise<void> | null,
    collectUnavailable: [] as string[],
    storeTypeAtConfirm: [] as string[],
    selectTitles: [] as string[],
    readStoreType: (() => '') as () => string,
}))

const streamBox = vi.hoisted(() => ({
    useBlobFallback: false,
    mitm: '',
    createWriteStream: undefined as unknown,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => 'chosen.bin'),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({ default: streamBox }))

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

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => { }),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

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

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => world.db as Database),
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

// The alert module is the real one over the store above; only the prompts and the waits that block are replaced.
vi.mock('src/ts/alert', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/alert')>()),
    alertConfirm: vi.fn(async (msg: string) => {
        world.confirm.push(msg)
        return world.confirmAnswer
    }),
    alertError: vi.fn(),
    alertMd: vi.fn(),
    alertSelect: vi.fn(async (_items: string[], title: string) => {
        world.selectTitles.push(title)
        return '0'
    }),
    alertNormalWait: vi.fn(async (msg: string) => { world.notices.push(msg) }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

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

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => {
        world.confirm.push('incomplete-data')
        world.storeTypeAtConfirm.push(world.readStoreType())
        return world.confirmAnswer
    }),
    getColdStorageBackupKey: vi.fn(() => null),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

// The cold-storage collection can be held, and made to report a unit that is unavailable.
vi.mock('src/ts/drive/exportInline', async (importOriginal) => {
    const real = await importOriginal<typeof import('src/ts/drive/exportInline')>()
    return {
        ...real,
        collectBackupColdStorage: vi.fn(async (...args: Parameters<typeof real.collectBackupColdStorage>) => {
            if (world.collectGate) {
                await world.collectGate
            }
            const collected = await real.collectBackupColdStorage(...args)
            return world.collectUnavailable.length > 0 ? { ...collected, unavailableKeys: [...world.collectUnavailable] } : collected
        }),
    }
})

// The assets are listed and read through the page's byte store; `world.files` is what it holds.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    return appStoreModuleOver(() => forageOverMap(world.files)) as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { exportThisTabBackup } from 'src/ts/drive/backuplocal'
import { createPeerUi } from 'src/ts/storage/store2/ui/peerUi'
import type { PeerExportResult } from 'src/ts/storage/store2/ui/peerUi'
import type { PeerParkPrompt } from 'src/ts/storage/store2/saveLoop'
import { alertStore } from 'src/ts/stores.svelte'
import type { alertData } from 'src/ts/alert'

const bytes = (text: string) => new TextEncoder().encode(text)

/** The peer UI as the app builds it, over the real `exportThisTabBackup`; a reload would be a failure of these tests. */
const reload = vi.fn()
function realPeerUi() {
    return createPeerUi({
        reload,
        exportAvailable: true,
        exportThisTab: async (_manifestKey: string): Promise<PeerExportResult> => {
            const outcome = await exportThisTabBackup()
            return outcome.status === 'saved' ? { status: 'saved', notices: outcome.notices } : { status: outcome.status }
        },
    })
}

const parkedPrompt: PeerParkPrompt = {
    reason: 'peer-commit',
    unsaved: true,
    offers: ['reload', 'export-first'],
    saveMineUnavailable: 'node',
}

beforeEach(() => {
    platformBox.isTauri = false
    world.stallAfter = Number.POSITIVE_INFINITY
    world.writes = []
    world.closes = 0
    world.aborts = 0
    world.releases = []
    world.selectTitles = []
    streamBox.createWriteStream = vi.fn((_filename: string) => ({
        ready: Promise.resolve(),
        writable: {
            getWriter: () => ({
                write: (data: Uint8Array) => {
                    world.writes.push(data.slice())
                    if (world.writes.length > world.stallAfter) {
                        return new Promise<void>((resolve) => { world.releases.push(resolve) })
                    }
                    return Promise.resolve()
                },
                close: () => {
                    world.closes += 1
                    return Promise.resolve()
                },
                // An abort waits behind a write the far side never takes.
                abort: () => {
                    world.aborts += 1
                    return world.releases.length > 0 ? new Promise<void>(() => { }) : Promise.resolve()
                },
            }),
        },
    }))
    world.files = new Map([['assets/profile.png', bytes('profile')]])
    world.db = {
        characters: [{ chaId: 'a', name: 'A', type: 'character', chatPage: 0, chats: [], image: 'assets/profile.png' }],
        personas: [],
        characterOrder: ['a'],
        botPresets: [],
    }
    alertStore.set({ type: 'none', msg: '' })
    reload.mockClear()
    return () => {
        vi.restoreAllMocks()
    }
})

/** Waits until the export is stalled on its second write (the database), and returns the dialog on screen. */
async function dialogAtStall(): Promise<alertData> {
    world.stallAfter = 1
    await vi.waitFor(() => expect(world.writes.length).toBe(2))
    return get(alertStore) as alertData
}

describe('the automatic export of a parked tab, wired to the real export', () => {
    test('(R) a stalled export shows a Cancel, and pressing it ends the export as not finished', async () => {
        const result = realPeerUi().autoExport('manifest')
        const dialog = await dialogAtStall()
        expect(dialog.type).toBe('wait')
        expect(dialog.onCancel).toBeTypeOf('function')

        dialog.onCancel?.()

        expect(await result).toBe('declined')
        expect(reload).not.toHaveBeenCalled()
    })

    test('(N) the park prompt waits for the closable incomplete-file notice, then names the export as not finished', async () => {
        const peer = realPeerUi()
        const result = peer.autoExport('manifest')
        const dialog = await dialogAtStall()
        dialog.onCancel?.()
        expect(await result).toBe('declined')

        const decision = peer.decide({ ...parkedPrompt, autoExport: 'not-finished' })
        for (let i = 0; i < 6; i++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        // The notice is up and holds the question until it is closed.
        expect((get(alertStore) as alertData).msg).toBe(language.backupCancelledFileIncomplete)
        expect(world.selectTitles).toEqual([])

        alertStore.set({ type: 'none', msg: '' })
        expect(await decision).toBe('reload')
        expect(world.selectTitles).toHaveLength(1)
        expect(world.selectTitles[0]).toContain(language.store2Boot.peerAutoExportNotFinished)
    })
})

describe('Export this tab first, wired to the real export', () => {
    test('(R) a stalled export shows a Cancel, and pressing it declines without the reload hand-off', async () => {
        const result = realPeerUi().exportThisTab('manifest')
        const dialog = await dialogAtStall()
        expect(dialog.onCancel).toBeTypeOf('function')

        dialog.onCancel?.()

        expect(await result).toBe('declined')
        expect(world.selectTitles).toEqual([])
        expect(reload).not.toHaveBeenCalled()
    })
})
