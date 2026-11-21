// @vitest-environment happy-dom

/**
 * The `.bin` export on its task card. The real `SaveLocalBackup`, `SavePartialLocalBackup`, `exportThisTabBackup`,
 * `LocalWriter`, `openWebExportWriter`, the alert module over a writable store, `alertTask` and `exportTask` run; the
 * vendored download helper (`streamSaver`) is replaced by a stream writer that can stall, which is what a browser that
 * ended its download early looks like to the page, and the Tauri save dialog is a held mock. Cards are read through
 * `taskHostView()` and `taskShown()`, with a clock that advances at every read so each report publishes at once.
 *
 * Labels: (R) reproducer, fails on the code before the card route because no card exists and the export's wait or notice
 * is on the alert store instead; (G) guard, passes with or without the card route.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { MintedStubEntry } from 'src/ts/drive/exportInline'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const world = vi.hoisted(() => ({
    db: {} as unknown,
    files: new Map<string, Uint8Array>(),
    confirm: [] as string[],
    confirmAnswer: true,
    /** Called by every prompt the export asks, with its text, before the answer is given. */
    onConfirm: null as ((message: string) => void) | null,
    /** Writes after the first `stallAfter` never settle until `releases` run. */
    stallAfter: Number.POSITIVE_INFINITY,
    writes: [] as Uint8Array[],
    closes: 0,
    aborts: 0,
    created: 0,
    releases: [] as Array<() => void>,
    helperAnswers: true,
    readyGate: null as Promise<void> | null,
    collectGate: null as Promise<void> | null,
    collectUnavailable: [] as string[],
    stubEntries: new Map<string, MintedStubEntry>(),
    /** Called at each write the stream takes, and where the writer's stream is created. */
    onWrite: null as (() => void) | null,
    onCreate: null as (() => void) | null,
    writeError: null as Error | null,
    /** Items the 4 GiB prompt names, and assets the upstream prompt names. */
    oversizeItems: [] as Array<{ name: string, size: number }>,
    upstreamOversize: [] as Array<{ key: string, size: number }>,
    moduleFailure: null as Error | null,
    /** Called each time the export reads `isNodeServer`, which it does right before the writer's gesture and open. */
    onServerProbe: null as (() => void) | null,
    saveGate: null as Promise<string | null> | null,
}))

const streamBox = vi.hoisted(() => ({
    useBlobFallback: false,
    mitm: '',
    createWriteStream: undefined as unknown,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => world.saveGate ?? 'chosen.bin'),
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
    get isNodeServer() {
        world.onServerProbe?.()
        return false
    },
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

// The alert module is the real one over the store above; the prompts that block are replaced, and the calls the card
// route must not make (a wait) or must make (a report) are spied with their real behaviour kept.
vi.mock('src/ts/alert', async (importOriginal) => {
    const real = await importOriginal<typeof import('src/ts/alert')>()
    return {
        ...real,
        alertConfirm: vi.fn(async (msg: string) => {
            world.confirm.push(msg)
            world.onConfirm?.(msg)
            return world.confirmAnswer
        }),
        alertError: vi.fn(),
        alertMd: vi.fn(),
        alertWait: vi.fn(real.alertWait),
        alertNormal: vi.fn(real.alertNormal),
        alertNormalWait: vi.fn(async (msg: string) => { world.confirm.push(msg); world.onConfirm?.(msg) }),
    }
})

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
    // Called even when nothing is unavailable, where the real one answers at once without a prompt: only a real prompt is recorded.
    confirmIncompleteColdStorageOperation: vi.fn(async () => {
        if (world.collectUnavailable.length === 0) {
            return true
        }
        world.confirm.push('incomplete-data')
        world.onConfirm?.('incomplete-data')
        return world.confirmAnswer
    }),
    getColdStorageBackupKey: vi.fn(() => null),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

// The cold-storage collection can be held and made to report a unit that is unavailable, and the 4 GiB prompt can be made
// to name items without 4 GiB of data.
vi.mock('src/ts/drive/exportInline', async (importOriginal) => {
    const real = await importOriginal<typeof import('src/ts/drive/exportInline')>()
    return {
        ...real,
        collectBackupColdStorage: vi.fn(async (...args: Parameters<typeof real.collectBackupColdStorage>) => {
            if (world.collectGate) {
                await world.collectGate
            }
            const collected = await real.collectBackupColdStorage(...args)
            const withStubs = world.stubEntries.size > 0 ? { ...collected, stubEntries: new Map(world.stubEntries) } : collected
            return world.collectUnavailable.length > 0 ? { ...withStubs, unavailableKeys: [...world.collectUnavailable] } : withStubs
        }),
        leaveOutOversizePayloads: vi.fn((...args: Parameters<typeof real.leaveOutOversizePayloads>) => (
            world.oversizeItems.length > 0 ? { cold: args[0], items: world.oversizeItems } : real.leaveOutOversizePayloads(...args)
        )),
    }
})

// The size pass names what the upstream Node server cannot hold; the 100 MiB threshold is not reachable with test data.
vi.mock('src/ts/drive/backupUpstreamSizes', async (importOriginal) => {
    const real = await importOriginal<typeof import('src/ts/drive/backupUpstreamSizes')>()
    return {
        ...real,
        findOversizeAssets: vi.fn(async (query: Parameters<typeof real.findOversizeAssets>[0]) => {
            query.onProgress?.(1, 1)
            return world.upstreamOversize
        }),
    }
})

vi.mock('src/ts/drive/exportModules', async (importOriginal) => {
    const real = await importOriginal<typeof import('src/ts/drive/exportModules')>()
    return {
        ...real,
        snapshotModuleList: vi.fn(async (...args: Parameters<typeof real.snapshotModuleList>) => {
            if (world.moduleFailure) {
                throw world.moduleFailure
            }
            return await real.snapshotModuleList(...args)
        }),
    }
})

// The assets are listed and read through the page's byte store; `world.files` is what it holds.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    return { ...appStoreModuleOver(() => forageOverMap(world.files)), getAppStoreKind: async () => 'node' } as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup, exportThisTabBackup } from 'src/ts/drive/backuplocal'
import type { ExportOutcome } from 'src/ts/drive/operationEnd'
import { ExportModuleUnreadableError, snapshotModuleList } from 'src/ts/drive/exportModules'
import { collectBackupColdStorage } from 'src/ts/drive/exportInline'
import { setLegacyPartialSave, resetLegacyPartialSaveForTests } from 'src/ts/storage/legacyPartialSave'
import { dispatchBack } from 'src/ts/backHandlers'
import { alertStore } from 'src/ts/stores.svelte'
import { alertError, alertMd, alertNormal, alertWait } from 'src/ts/alert'
import { alertTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskShown } from 'src/ts/alertTask.svelte'
import { downloadNotice } from 'src/ts/exportNotice'
import { save } from '@tauri-apps/plugin-dialog'

const bytes = (text: string) => new TextEncoder().encode(text)

beforeEach(() => {
    resetTaskHostForTests()
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
    resetLegacyPartialSaveForTests()
    platformBox.isTauri = false
    world.confirm = []
    world.confirmAnswer = true
    world.onConfirm = null
    world.stallAfter = Number.POSITIVE_INFINITY
    world.writes = []
    world.closes = 0
    world.aborts = 0
    world.created = 0
    world.releases = []
    world.helperAnswers = true
    world.readyGate = null
    world.collectGate = null
    world.collectUnavailable = []
    world.stubEntries = new Map()
    world.onWrite = null
    world.onCreate = null
    world.writeError = null
    world.oversizeItems = []
    world.upstreamOversize = []
    world.moduleFailure = null
    world.onServerProbe = null
    world.saveGate = null
    streamBox.useBlobFallback = false
    streamBox.createWriteStream = vi.fn((_filename: string) => {
        world.created += 1
        world.onCreate?.()
        return {
            ready: world.readyGate ?? (world.helperAnswers ? Promise.resolve() : new Promise<void>(() => { })),
            writable: {
                getWriter: () => ({
                    write: (data: Uint8Array) => {
                        world.writes.push(data.slice())
                        world.onWrite?.()
                        if (world.writeError) {
                            return Promise.reject(world.writeError)
                        }
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
        }
    })
    world.files = new Map([
        ['assets/profile.png', bytes('profile')],
        ['assets/emotion.png', bytes('emotion')],
        ['assets/extra.png', bytes('extra')],
    ])
    world.db = {
        characters: [{
            chaId: 'a',
            name: 'A',
            type: 'character',
            chatPage: 0,
            chats: [],
            image: 'assets/profile.png',
            emotionImages: [['happy', 'assets/emotion.png']],
            additionalAssets: [['extra', 'assets/extra.png', 'png']],
        }],
        personas: [],
        characterOrder: ['a'],
        botPresets: [],
    }
    alertStore.set({ type: 'none', msg: '' })
    vi.mocked(alertError).mockClear()
    vi.mocked(alertMd).mockClear()
    vi.mocked(alertWait).mockClear()
    vi.mocked(alertNormal).mockClear()
    vi.mocked(save).mockClear()
    vi.mocked(collectBackupColdStorage).mockClear()
    return () => {
        setTaskClockForTests(null)
        vi.useRealTimers()
        vi.restoreAllMocks()
    }
})

/** The label of the step the shown card is on. */
function stepLabel(): string | undefined {
    const view = taskHostView()
    return view === null ? undefined : view.steps[view.stepIndex]?.label
}

/** Starts a full export that stops accepting writes after `stallAfter` and waits until it is stalled. */
async function stalledFullExport(stallAfter: number): Promise<{ outcome: Promise<ExportOutcome> }> {
    world.stallAfter = stallAfter
    const outcome = SaveLocalBackup()
    await vi.waitFor(() => expect(world.writes.length).toBe(stallAfter + 1))
    return { outcome }
}

/** Lets a stalled export finish: writes go through again and the stalled ones settle. */
function releaseStall(): void {
    world.stallAfter = Number.POSITIVE_INFINITY
    for (const release of world.releases) {
        release()
    }
}

/** Records the id of the card in the slot (null when empty) at every timer tick until the returned stop is called. */
function probeSlot(into: Array<number | null>): () => void {
    const timer = setInterval(() => { into.push(taskHostView()?.id ?? null) }, 0)
    return () => clearInterval(timer)
}

describe('a full backup on the web', () => {
    test('BK1 (R) shows the card at the asset step with its count and Cancel, posts no wait, and ends on the done card', async () => {
        const { outcome } = await stalledFullExport(1)

        const view = taskHostView()
        expect(view?.title).toBe(language.backupTaskTitle)
        expect(stepLabel()).toBe(language.exportStepAssets)
        expect(view?.count).toEqual({ done: 1, total: 3 })
        expect(view?.cancelOffered).toBe(true)
        expect(alertWait).not.toHaveBeenCalled()

        releaseStall()
        expect((await outcome).status).toBe('saved')
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.headline).toBe(language.backupTaskDone)
        expect(taskHostView()?.result?.summary).toEqual([downloadNotice(language.rtbExportSaved)])
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('BK2 (R) (a) a Cancel on the card mid-write ends cancelled with the incomplete-file line; the writer is aborted once and the inlay lock is free', async () => {
        const { getAppStore } = await import('src/ts/storage/store/appStore')
        const { writeAppInlay, withInlayLock } = await import('src/ts/process/files/inlayStore')
        const store = await getAppStore()
        await withInlayLock('stalled-inlay.png', () => writeAppInlay(store, 'stalled-inlay.png', {
            ...{ ext: 'png', name: 'stalled.png', type: 'image', width: 1, height: 1 } as Record<string, unknown>,
            data: new Blob([bytes('inlay-body')], { type: 'image/png' }),
        }))
        // The three assets are written, then the first write of the inlay entry stalls while it holds the inlay's lock.
        const { outcome } = await stalledFullExport(3)

        expect(taskHostView()?.cancelOffered).toBe(true)
        requestTaskCancel()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
        expect(world.aborts).toBe(1)
        expect(alertNormal).not.toHaveBeenCalledWith(language.backupCancelledFileIncomplete)
        const lockFree = await Promise.race([
            withInlayLock('stalled-inlay.png', async () => 'free'),
            new Promise<string>((resolve) => setTimeout(() => resolve('still held'), 500)),
        ])
        expect(lockFree).toBe('free')
    })

    test('BK2 (R) (b) a Cancel during the held cold collection ends untouched: no prompt, no writer, "Nothing was changed"', async () => {
        let release: () => void = () => { }
        world.collectGate = new Promise<void>((resolve) => { release = resolve })
        const outcome = SaveLocalBackup()
        await vi.waitFor(() => expect(collectBackupColdStorage).toHaveBeenCalled())

        expect(taskHostView()?.cancelOffered).toBe(true)
        requestTaskCancel()
        release()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'untouched' })
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toBeUndefined()
        expect(world.created).toBe(0)
        expect(world.confirm).toEqual([])
    })
})

describe('plain prompts over the card', () => {
    /** Samples the slot at every prompt the export asks. */
    function sampleAtPrompts(): Array<{ message: string, shown: boolean, id: number | undefined, label: string | undefined }> {
        const seen: Array<{ message: string, shown: boolean, id: number | undefined, label: string | undefined }> = []
        world.onConfirm = (message) => { seen.push({ message, shown: taskShown(), id: taskHostView()?.id, label: stepLabel() }) }
        return seen
    }

    test('BK3 (R) (a) the unavailable-data prompt is asked with the same card in the slot, and the run keeps that one card', async () => {
        world.collectUnavailable = ['unit-that-is-gone']
        const seen = sampleAtPrompts()

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(seen).toHaveLength(1)
        expect(seen[0].shown).toBe(true)
        expect(seen[0].label).toBe(language.backupStepCollect)
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.id).toBe(seen[0].id)
    })

    test('BK3 (R) (b) the 4 GiB prompt and the upstream-oversize prompt are asked over the same card', async () => {
        world.oversizeItems = [{ name: 'Item X', size: 5 }]
        world.upstreamOversize = [{ key: 'assets/profile.png', size: 200 * 1024 * 1024 }]
        const seen = sampleAtPrompts()

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(seen.map((entry) => entry.message)).toEqual([language.backupOversizeConfirm(['Item X (0.00 GiB)']), expect.stringContaining('larger than 100 MiB')])
        // Both save with a report, so the card closes at the end; until then it is the one card of the run.
        for (const entry of seen) {
            expect(entry.shown).toBe(true)
            expect(entry.id).toBe(seen[0].id)
        }
        expect(taskShown()).toBe(false)
    })

    test('BK3 (R) (c) the legacy-partial prompt: accepted, the same card runs on; declined, no card is left and nothing is posted', async () => {
        setLegacyPartialSave({ backupTime: 100, omitted: new Map() })
        let atWriterOpen: number | undefined
        world.onCreate = () => { atWriterOpen = taskHostView()?.id }
        const seen = sampleAtPrompts()

        const accepted = await SaveLocalBackup()

        expect(accepted.status).toBe('saved')
        expect(seen).toHaveLength(1)
        expect(seen[0].shown).toBe(true)
        expect(seen[0].label).toBe(language.backupStepCollect)
        expect(atWriterOpen).toBe(seen[0].id)
        expect(taskHostView()?.id).toBe(seen[0].id)

        resetTaskHostForTests()
        setLegacyPartialSave({ backupTime: 100, omitted: new Map() })
        world.confirmAnswer = false

        const declined = await SaveLocalBackup()

        expect(declined).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(taskShown()).toBe(false)
        expect(alertNormal).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('BK15 (G) Back during a plain prompt answers the prompt and never presses the card\'s Cancel, for a confirm and for a notice', async () => {
        world.collectUnavailable = ['unit-that-is-gone']
        const afterBack: Array<{ type: string, cancelled: boolean | undefined, cancelRequested: boolean }> = []
        world.onConfirm = () => {
            // A confirm covers the page as an `ask`; the gesture notice covers it as a `normal`. Back reaches neither's card.
            for (const type of ['ask', 'normal'] as const) {
                alertStore.set({ type, msg: 'q' })
                dispatchBack()
                afterBack.push({ type: get(alertStore).type, cancelled: taskHostView()?.cancelled, cancelRequested: taskHostView()?.state === 'cancelling' })
            }
            alertStore.set({ type: 'none', msg: '' })
            world.confirmAnswer = false
        }

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(afterBack).toEqual([
            { type: 'ask', cancelled: false, cancelRequested: false },
            { type: 'none', cancelled: false, cancelRequested: false },
        ])
    })
})

describe('the leave-out sheet', () => {
    const askWith = (answer: boolean | null, sampled: Array<{ shown: boolean }>) => async () => {
        sampled.push({ shown: taskShown() })
        return answer
    }

    function withTaskPreset(): void {
        (world.db as { taskPresets?: Array<{ name: string }> }).taskPresets = [{ name: 'my preset' }]
    }

    test('BK4 (R) (a) the slot is empty while the sheet is up, and (b) the card is back at the asset step before the server probe', async () => {
        withTaskPreset()
        const atSheet: Array<{ shown: boolean }> = []
        const atProbe: Array<{ shown: boolean, label: string | undefined }> = []
        let answered = false
        world.onServerProbe = () => { if (answered) atProbe.push({ shown: taskShown(), label: stepLabel() }) }

        const outcome = await SaveLocalBackup({
            askLeaveOut: async () => {
                atSheet.push({ shown: taskShown() })
                answered = true
                return true
            },
        })

        expect(outcome.status).toBe('saved')
        expect(atSheet).toEqual([{ shown: false }])
        expect(atProbe[0]).toEqual({ shown: true, label: language.exportStepAssets })
    })

    test('BK4 (R) (c) an unanswered sheet falls back to the per-kind prompts, asked with the card back in the slot', async () => {
        withTaskPreset()
        const atPrompt: boolean[] = []
        world.onConfirm = () => { atPrompt.push(taskShown()) }
        const sampled: Array<{ shown: boolean }> = []

        const outcome = await SaveLocalBackup({ askLeaveOut: askWith(null, sampled) })

        expect(outcome.status).toBe('saved')
        expect(sampled).toEqual([{ shown: false }])
        expect(world.confirm).toEqual([expect.stringContaining('my preset')])
        expect(atPrompt).toEqual([true])
    })

    test('BK4 (R) (d) a declined sheet ends with no card and nothing posted', async () => {
        withTaskPreset()
        const sampled: Array<{ shown: boolean }> = []

        const outcome = await SaveLocalBackup({ askLeaveOut: askWith(false, sampled) })

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(taskShown()).toBe(false)
        expect(alertNormal).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('BK4 (R) (e) a sheet that throws while the card is held ends on a fail card with nothing written, and logs once', async () => {
        withTaskPreset()
        vi.spyOn(console, 'error').mockImplementation(() => { })

        const outcome = await SaveLocalBackup({ askLeaveOut: async () => { throw new Error('sheet') } })

        expect(outcome.status).toBe('failed')
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.headline).toBe(language.backupTaskFailed)
        expect(taskHostView()?.failure?.detail).toBe(language.backupFailedNothingWritten())
        expect(alertError).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledTimes(1)
    })
})

describe('the native save dialog on Tauri desktop', () => {
    function holdDialog(): (path: string | null) => void {
        let deliver: (path: string | null) => void = () => { }
        world.saveGate = new Promise<string | null>((resolve) => { deliver = resolve })
        return (path) => deliver(path)
    }

    test('BK5 (R) (a) no card stands over the pending dialog; a chosen path brings the card back without Cancel, and it ends done', async () => {
        platformBox.isTauri = true
        const deliver = holdDialog()
        const exporting = SaveLocalBackup()
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

        expect(taskShown()).toBe(false)
        deliver('chosen.bin')
        const outcome = await exporting

        expect(outcome.status).toBe('saved')
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.cancelOffered).toBe(false)
    })

    test('BK5 (b) a dismissed dialog declines; the card is never re-shown from the dialog\'s start to the run\'s end and nothing is posted', async () => {
        platformBox.isTauri = true
        const deliver = holdDialog()
        const slot: Array<number | null> = []
        const stop = probeSlot(slot)
        const exporting = SaveLocalBackup()
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        slot.length = 0

        deliver(null)
        const outcome = await exporting
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        stop()

        expect(outcome).toEqual({ status: 'declined', cause: 'save-dialog-cancelled' })
        expect(slot.every((id) => id === null)).toBe(true)
        expect(taskShown()).toBe(false)
        expect(alertNormal).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('BK5 (R) (c) with the sheet answered true the slot stays empty from the sheet until a path is delivered, then the card is back', async () => {
        platformBox.isTauri = true
        ;(world.db as { taskPresets?: Array<{ name: string }> }).taskPresets = [{ name: 'my preset' }]
        const deliver = holdDialog()
        const slot: Array<number | null> = []
        const stop = probeSlot(slot)
        const probes: boolean[] = []
        let answered = false
        world.onServerProbe = () => { if (answered) probes.push(taskShown()) }

        const exporting = SaveLocalBackup({
            askLeaveOut: async () => {
                answered = true
                slot.length = 0
                return true
            },
        })
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        await new Promise<void>((resolve) => setTimeout(resolve, 10))

        expect(slot.every((id) => id === null)).toBe(true)
        expect(probes.every((shown) => !shown)).toBe(true)

        deliver('chosen.bin')
        expect((await exporting).status).toBe('saved')
        stop()
        expect(taskHostView()?.state).toBe('done')
    })
})

describe('endings', () => {
    test('BK7 (R) a save with a missing asset closes the card and posts the report once', async () => {
        const unreadable = new Set(['assets/extra.png'])
        const original = Map.prototype.get
        vi.spyOn(world.files, 'get').mockImplementation(function (this: Map<string, Uint8Array>, key: string) {
            return unreadable.has(key) ? undefined : original.call(this, key)
        })
        let shownDuringRun = false
        world.onWrite = () => { shownDuringRun = taskShown() }

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(shownDuringRun).toBe(true)
        expect(taskShown()).toBe(false)
        expect(alertMd).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertMd).mock.calls[0][0])).toContain('assets/extra.png')
    })

    test('BK8 (R) (a) a write that throws on the web ends on a fail card with today\'s kept-file sentence, and posts no error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        world.writeError = new Error('the output stream is down')

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('failed')
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe(language.backupFailedFileKept(null))
        expect(alertError).not.toHaveBeenCalled()
    })

    test('BK8 (R) (b) an unreadable module names the module on the fail card', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const failure = new ExportModuleUnreadableError('idd', 'Module idd', new Error('damaged'))
        world.moduleFailure = failure

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('failed')
        expect(vi.mocked(snapshotModuleList)).toHaveBeenCalled()
        expect(taskHostView()?.failure?.detail).toBe(language.backupFailedModuleUnreadable('Module idd', failure.reason))
        expect(alertError).not.toHaveBeenCalled()
    })

    test('BK9 (a) (G) the two explanation confirms of a partial backup come before the card; (b) (R) the card has no inlays step and its done summary adds the inlays sentence', async () => {
        const atConfirm: boolean[] = []
        world.onConfirm = () => { atConfirm.push(taskShown()) }

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(atConfirm).toEqual([false, false])
        expect(taskHostView()?.title).toBe(language.backupTaskPartialTitle)
        expect(taskHostView()?.steps.map((step) => step.label)).not.toContain(language.backupStepInlays)
        expect(taskHostView()?.result?.summary).toEqual([downloadNotice(language.rtbExportSaved), language.partialBackupInlaysNotIncluded])
    })

    test('BK9 (c) (R) on Tauri the done summary of a full clean save is the rtbExportSaved line, not a bare "Success"', async () => {
        platformBox.isTauri = true

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(taskHostView()?.result?.summary).toEqual([language.rtbExportSaved])
    })

    test('BK9 (d) (R) on Tauri the done summary of a partial clean save is the rtbExportSaved line plus the inlays sentence', async () => {
        platformBox.isTauri = true

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(taskHostView()?.result?.summary).toEqual([language.rtbExportSaved, language.partialBackupInlaysNotIncluded])
    })

    test('BK14 (R) no wait is ever posted and no card text carries a percent sign over a full run', async () => {
        const texts: string[] = []
        world.onWrite = () => {
            const view = taskHostView()
            texts.push([view?.title, ...(view?.steps.map((step) => step.label) ?? [])].join('|'))
        }

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(texts.length).toBeGreaterThan(0)
        expect(texts.some((text) => text.includes('%'))).toBe(false)
        expect(alertWait).not.toHaveBeenCalled()
    })
})

describe('a card that a newer task replaced', () => {
    const newerTask = () => alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })

    test('BK12 (R) (a) a clean save ends silently and the newer card stays', async () => {
        const { outcome } = await stalledFullExport(1)
        newerTask()

        releaseStall()

        expect((await outcome).status).toBe('saved')
        expect(alertNormal).not.toHaveBeenCalled()
        expect(taskHostView()?.title).toBe('Newer task')
    })

    test('BK12 (R) (b) a card held aside for the sheet does not replace a newer task, and a kept-file failure is still posted', async () => {
        ;(world.db as { taskPresets?: Array<{ name: string }> }).taskPresets = [{ name: 'my preset' }]
        vi.spyOn(console, 'error').mockImplementation(() => { })
        world.writeError = new Error('the output stream is down')

        const outcome = await SaveLocalBackup({
            askLeaveOut: async () => {
                newerTask()
                return true
            },
        })

        expect(outcome.status).toBe('failed')
        expect(alertError).toHaveBeenCalledWith(language.backupFailedFileKept(null))
        expect(taskHostView()?.title).toBe('Newer task')
        expect(taskHostView()?.state).toBe('running')
    })

    test('BK12 (R) (c) a save with a missing asset still posts its report, once, and the newer card is unchanged', async () => {
        const original = Map.prototype.get
        vi.spyOn(world.files, 'get').mockImplementation(function (this: Map<string, Uint8Array>, key: string) {
            return key === 'assets/extra.png' ? undefined : original.call(this, key)
        })
        const { outcome } = await stalledFullExport(1)
        const newer = newerTask()

        releaseStall()

        expect((await outcome).status).toBe('saved')
        expect(alertMd).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertMd).mock.calls[0][0])).toContain('assets/extra.png')
        expect(newer.detached).toBe(false)
        expect(taskHostView()?.title).toBe('Newer task')
    })
})

describe('the web writer open', () => {
    test('BK13 (R) the card is at the asset step with Cancel while the helper wait is held, though a prompt was asked before', async () => {
        world.collectUnavailable = ['unit-that-is-gone']
        world.helperAnswers = false
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        void SaveLocalBackup()
        for (let i = 0; i < 200 && world.created < 1; i++) {
            await vi.advanceTimersByTimeAsync(0)
        }
        expect(world.created).toBe(1)

        expect(world.confirm).toHaveLength(1)
        expect(taskHostView()?.cancelOffered).toBe(true)
        expect(stepLabel()).toBe(language.exportStepAssets)
    })
})

describe('the peer-park export keeps today\'s dialogs', () => {
    test('BK11 (G) a stalled exportThisTabBackup has no card, and its wait carries the Cancel', async () => {
        world.stallAfter = 1
        void exportThisTabBackup()
        await vi.waitFor(() => expect(world.writes.length).toBe(2))

        expect(taskHostView()).toBeNull()
        const dialog = get(alertStore)
        expect(dialog.type).toBe('wait')
        expect((dialog as { onCancel?: () => void }).onCancel).toBeTypeOf('function')
    })
})
