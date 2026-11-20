// @vitest-environment happy-dom

/**
 * A module export on the task card (S6a): `.charx` through exportModule and `.risum` through exportModuleLegacy. The
 * real exports, LocalWriter, openWebExportWriter, CharXWriter, streamRisum and the real task slot run; the vendored
 * download helper (streamSaver) is replaced by a stream writer that can stall, fail, hold its ready promise or report
 * its close, and the Tauri file system and save dialog are replaced as in the desktop suites, so one harness serves the
 * web and the desktop routes. This proves what the page does, not what a browser or the native dialog does.
 *
 * Labels: each test names its class in the S6a plan. RR rows fail on the pre-card code by assertion; CG rows are
 * compatibility guards that pass before and after.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const world = vi.hoisted(() => ({
    png: new Uint8Array() as Uint8Array,
    files: new Map<string, Uint8Array>(),
    stallAfter: Number.POSITIVE_INFINITY,
    writes: [] as Uint8Array[],
    closes: 0,
    aborts: 0,
    releases: [] as Array<() => void>,
    errors: [] as string[],
    // the order of the stream opening and of the asset reads
    order: [] as string[],
}))

const streamBox = vi.hoisted(() => ({
    useBlobFallback: false,
    mitm: '',
    createWriteStream: undefined as unknown,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid-1' }))

vi.mock('src/ts/vendor/streamSaver', () => ({ default: streamBox }))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => 'chosen.bin'),
}))

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

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false })),
    setDatabase: vi.fn(),
    setDatabaseLite: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: [] } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
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
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

// The alert module is the real one over the store above; only the calls that block or show an error are replaced.
vi.mock('src/ts/alert', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/alert')>()),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { world.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertMd: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/util')>()),
    isKnownUri: vi.fn(() => false),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/characters')>()),
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'PNG'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

// The real table is fetched from a URL, which this file answers with a placeholder image; a fixed invertible byte map stands in (3 is added after multiplying by 7; 183 is 7 inverted mod 256).
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, (b) => (b * 7 + 3) & 0xff)),
    decodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, (b) => ((b - 3 + 256) * 183) & 0xff)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

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

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

// The assets are read through the page's byte store; `world.files` is what it holds.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    return appStoreModuleOver(() => forageOverMap(world.files)) as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { exportModule, exportModuleLegacy, readModule, type RisuModule } from 'src/ts/process/modules'
import { LocalWriter } from 'src/ts/globalApi.svelte'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { alertStore } from 'src/ts/stores.svelte'
import { alertError, alertNormalWait, type alertData } from 'src/ts/alert'
import { sleep } from 'src/ts/util'
import { downloadNotice } from 'src/ts/exportNotice'
import { STREAM_HELPER_READY_TIMEOUT_MS } from 'src/ts/exportWriters'
import { save } from '@tauri-apps/plugin-dialog'
import {
    requestTaskCancel,
    resetTaskHostForTests,
    setTaskClockForTests,
    taskHostView,
    taskResultShowing,
    taskShown,
} from 'src/ts/alertTask.svelte'
import type { TaskView } from 'src/lib/Nexus/pattern/taskProgress'

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

/** A module with `count` assets and no icon, so the export fetches and saves the stand-in image. */
function syntheticModule(count = 3): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'd',
        id: 'module-1',
        assets: Array.from({ length: count }, (_, i) => [`asset${i + 1}`, `assets/a${i + 1}`, 'png'] as [string, string, string]),
    }
}

/** A byte store map that reports the task card at every read, and can fail the read of any key outside the module's assets. */
class CardLogMap extends Map<string, Uint8Array> {
    views: Array<TaskView | null> = []
    failOutsideAssets = false
    get(key: string): Uint8Array | undefined {
        this.views.push(taskHostView())
        if (this.failOutsideAssets && !/^assets\/a\d$/.test(key)) {
            throw new Error('card image read failed')
        }
        return super.get(key)
    }
}

/** A clock that advances one second per read, so every report reaches the published view at once. */
function useSteppingClock(): void {
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
}

function freshFiles(): CardLogMap {
    return new CardLogMap([1, 2, 3].map((n) => [`assets/a${n}`, syntheticPng()] as [string, Uint8Array]))
}

/** Records whether a task card was shown at every alertStore write and at every save-dialog call. */
function watchForCard(): { everShown: () => boolean, stop: () => void } {
    let seen = false
    const stop = alertStore.subscribe(() => { seen ||= taskShown() })
    vi.mocked(save).mockImplementation(async () => {
        seen ||= taskShown()
        return 'chosen.bin'
    })
    return { everShown: () => seen || taskShown(), stop }
}

let shown: alertData[] = []
let unsubscribe: () => void = () => { }
let files = freshFiles()
const realFetch = globalThis.fetch
const hooks = { onClose: null as null | (() => void), onWrite: null as null | (() => void), ready: null as null | Promise<void> }
const stalledWriters: Array<(error: Error) => void> = []
/** Runs started against a helper that never answers, and the release for that helper; the cleanup settles them so a failed wait cannot leak a run into the next test. */
const unansweredRuns: Array<Promise<unknown>> = []
let answerHelper: () => void = () => { }

beforeEach(() => {
    platformBox.isTauri = false
    world.png = syntheticPng()
    files = freshFiles()
    world.files = files
    world.stallAfter = Number.POSITIVE_INFINITY
    world.writes = []
    world.closes = 0
    world.aborts = 0
    world.releases = []
    world.errors = []
    world.order = []
    stalledWriters.length = 0
    hooks.onClose = null
    hooks.onWrite = null
    hooks.ready = null
    const failAfter = { value: Number.POSITIVE_INFINITY }
    Object.assign(hooks, { failAfter })
    streamBox.useBlobFallback = false
    streamBox.createWriteStream = vi.fn((_filename: string) => ({
        ready: hooks.ready ?? Promise.resolve(),
        writable: {
            getWriter: () => ({
                write: (data: Uint8Array) => {
                    world.writes.push(data.slice())
                    hooks.onWrite?.()
                    if (world.writes.length > failAfter.value) {
                        return Promise.reject(new Error('synthetic stream failure'))
                    }
                    if (world.writes.length > world.stallAfter) {
                        return new Promise<void>((resolve, reject) => {
                            world.releases.push(resolve)
                            stalledWriters.push(reject)
                        })
                    }
                    return Promise.resolve()
                },
                close: () => {
                    hooks.onClose?.()
                    world.closes += 1
                    return Promise.resolve()
                },
                abort: () => {
                    world.aborts += 1
                    return world.releases.length > 0 ? new Promise<void>(() => { }) : Promise.resolve()
                },
            }),
        },
    }))
    globalThis.fetch = vi.fn(async () => new Response(syntheticPng().buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch
    vi.mocked(save).mockClear()
    vi.mocked(alertError).mockClear()
    vi.mocked(alertNormalWait).mockClear()
    alertStore.set({ type: 'none', msg: '' })
    resetTaskHostForTests()
    shown = []
    unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return async () => {
        vi.useRealTimers()
        requestTaskCancel()
        answerHelper()
        await Promise.allSettled(unansweredRuns.splice(0))
        unsubscribe()
        resetTaskHostForTests()
        vi.mocked(sleep).mockImplementation(async () => { })
        globalThis.fetch = realFetch
        vi.restoreAllMocks()
    }
})

/** Lets real asynchronous work (the preflight's dynamic imports) run while only setTimeout is faked, until the card offers Cancel. It waits on wall time, so a loaded machine cannot fail the wait. */
async function settleUntilCardOffersCancel(): Promise<void> {
    const deadline = performance.now() + 10_000
    while (taskHostView()?.cancelOffered !== true && performance.now() < deadline) {
        await new Promise<void>((resolve) => setImmediate(resolve))
    }
}

/** Starts a run whose helper never answers; the cleanup releases and settles it. */
function startAgainstUnansweredHelper(start: () => Promise<unknown>): Promise<unknown> {
    hooks.ready = new Promise<void>((resolve) => { answerHelper = resolve })
    const run = start()
    unansweredRuns.push(run)
    return run
}

function setFailAfter(count: number): void {
    ;(hooks as unknown as { failAfter: { value: number } }).failAfter.value = count
}

/** The ids of every task card seen at the asset reads and at the pause before the write. */
function trackTaskIds(): number[] {
    const ids: number[] = []
    vi.mocked(sleep).mockImplementation(async () => {
        const view = taskHostView()
        if (view !== null) {
            ids.push(view.id)
        }
    })
    return ids
}

describe('a module .charx export on the task card', () => {
    test('M1: one card runs from the opening to the result and the success result is posted once', async () => {
        const ids = trackTaskIds()
        await exportModule(syntheticModule(2))

        const seen = new Set([...ids, ...files.views.flatMap((view) => view === null ? [] : [view.id])])
        expect(seen.size).toBe(1)
        expect(taskHostView()?.title).toBe(language.exportTaskModuleTitle)
        expect(taskHostView()?.subtitle).toBe('Synthetic Module')
        expect(taskResultShowing()).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([downloadNotice(language.successExport)])
        expect(shown.filter((value) => value.type === 'normal')).toEqual([])
    })

    test('M1b: with alertEnd false nothing remains after the export and no result is posted (compatibility guard)', async () => {
        await exportModule(syntheticModule(2), { alertEnd: false })

        expect(taskShown()).toBe(false)
        expect(taskResultShowing()).toBe(false)
        expect(shown.filter((value) => value.type === 'normal')).toEqual([])
    })

    test('M2: a failure inside the card export ends one fail card and the module export posts nothing further', async () => {
        setFailAfter(2)
        await exportModule(syntheticModule(2))

        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('synthetic stream failure\n' + language.exportFailedFileIncomplete)
        expect(world.errors).toEqual([])
        expect(shown.filter((value) => value.type === 'normal')).toEqual([])
    })

    test('M3: Cancel is offered while the writer is still opening, and a Cancel later ends the run with a cancelled card', async () => {
        let answer: () => void = () => { }
        hooks.ready = new Promise<void>((resolve) => { answer = resolve })
        world.stallAfter = 2
        const done = exportModule(syntheticModule())
        await vi.waitFor(() => expect(taskHostView()?.cancelOffered).toBe(true), { timeout: 2000 })
        answer()
        await vi.waitFor(() => expect(world.writes.length).toBe(3), { timeout: 2000 })
        requestTaskCancel()
        await done

        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
        expect(world.errors).toEqual([])
    })

    test('M7: a rejected writer open ends as a fail card and exportModule resolves', async () => {
        vi.spyOn(LocalWriter.prototype, 'init').mockRejectedValueOnce(new Error('open failed'))

        const outcome = await exportModule(syntheticModule(2)).then(() => 'resolved', () => 'rejected')

        expect(outcome).toBe('resolved')
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('open failed')
        expect(taskHostView()?.state).not.toBe('running')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })

    test('M7b: a card image read that rejects inside the card export aborts the opened stream and ends a fail card with the incomplete-file sentence', async () => {
        files.failOutsideAssets = true

        const outcome = await exportModule(syntheticModule(2)).then(() => 'resolved', () => 'rejected')

        expect(outcome).toBe('resolved')
        expect(world.aborts).toBe(1)
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('card image read failed\n' + language.exportFailedFileIncomplete)
    })

    test('M8: a Cancel while the helper has not answered ends cancelled with no failure, no notice and no logged error', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const initSpy = vi.spyOn(LocalWriter.prototype, 'init')
        const done = startAgainstUnansweredHelper(() => exportModule(syntheticModule(2)))
        await settleUntilCardOffersCancel()
        expect(taskHostView()?.cancelOffered).toBe(true)
        requestTaskCancel()
        await vi.advanceTimersByTimeAsync(STREAM_HELPER_READY_TIMEOUT_MS)
        const outcome = await done.then(() => 'resolved', () => 'rejected')

        expect(outcome).toBe('resolved')
        expect(initSpy.mock.calls[0][3]).toBeDefined()
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toBeUndefined()
        expect(taskHostView()?.failure).toBeUndefined()
        expect(vi.mocked(alertNormalWait)).not.toHaveBeenCalledWith(language.exportHelperNotResponding)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(vi.mocked(console.error)).not.toHaveBeenCalled()
    })

    test('M9: a rejected Tauri save dialog call resolves with the legacy error and never shows a card', async () => {
        platformBox.isTauri = true
        const failure = new Error('dialog plugin failed')
        const watch = watchForCard()
        vi.mocked(save).mockRejectedValueOnce(failure)

        const outcome = await exportModule(syntheticModule(2)).then(() => 'resolved', () => 'rejected')
        watch.stop()

        expect(outcome).toBe('resolved')
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe(failure)
        expect(watch.everShown()).toBe(false)
    })

    test('M11: a failing stand-in icon fetch resolves with the legacy error and never shows a card', async () => {
        const failure = new Error('icon fetch failed')
        globalThis.fetch = vi.fn(async () => { throw failure }) as unknown as typeof fetch
        const initSpy = vi.spyOn(LocalWriter.prototype, 'init')
        const watch = watchForCard()

        const outcome = await exportModule(syntheticModule(2)).then(() => 'resolved', () => 'rejected')
        watch.stop()

        expect(outcome).toBe('resolved')
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe(failure)
        expect(initSpy).not.toHaveBeenCalled()
        expect(watch.everShown()).toBe(false)
    })
})

describe('a module .risum export on the task card', () => {
    const concatenated = () => Buffer.concat(world.writes)

    test('M4: the asset count reaches n/n before the close and the success summary is the download sentence', async () => {
        useSteppingClock()
        // The write step replaces the count, so the last view that still carries one is the terminator write before it.
        const atWrite: Array<TaskView | null> = []
        hooks.onWrite = () => { atWrite.push(taskHostView()) }
        await exportModuleLegacy(syntheticModule(3))

        const counted = atWrite.filter((view) => view?.count !== undefined)
        const view = counted[counted.length - 1]
        expect(view?.title).toBe(language.exportTaskModuleTitle)
        expect(view?.count).toEqual({ done: 3, total: 3 })
        expect(view?.cancelOffered).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([downloadNotice(language.successExport)])
        expect(shown.filter((value) => value.type === 'wait')).toEqual([])
    })

    test('M5: on Tauri the card opens after the save dialog returned and the summary names the chosen location', async () => {
        platformBox.isTauri = true
        let cardAtSave: boolean | undefined
        vi.mocked(save).mockImplementation(async () => {
            cardAtSave = taskShown()
            return 'chosen.risum'
        })
        await exportModuleLegacy(syntheticModule(2))

        expect(cardAtSave).toBe(false)
        expect(files.views.some((view) => view?.title === language.exportTaskModuleTitle)).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.successExportChosenLocation])
    })

    test('M6: the stream of a card export reads back through the real readModule with every asset (compatibility guard)', async () => {
        await exportModuleLegacy(syntheticModule(3), { alertEnd: false })

        const module = await readModule(concatenated())
        expect((module.assets ?? []).map((asset) => asset[0])).toEqual(['asset1', 'asset2', 'asset3'])
    })

    test('M10: a rejected Tauri save dialog call resolves null with the legacy error and no card (compatibility guard)', async () => {
        platformBox.isTauri = true
        const failure = new Error('dialog plugin failed')
        const watch = watchForCard()
        vi.mocked(save).mockRejectedValueOnce(failure)

        expect(await exportModuleLegacy(syntheticModule(2))).toBeNull()
        watch.stop()

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe(failure)
        expect(watch.everShown()).toBe(false)
    })

    test('M13: a rejected writer open ends as a fail card and resolves null', async () => {
        streamBox.createWriteStream = vi.fn(() => { throw new Error('open failed') })

        expect(await exportModuleLegacy(syntheticModule(2))).toBeNull()

        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('open failed')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(busyKinds()).not.toContain('export')
    })

    test('M14: a Cancel while the helper has not answered ends cancelled with no summary, no failure and no logged error', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const done = startAgainstUnansweredHelper(() => exportModuleLegacy(syntheticModule(2)))
        await settleUntilCardOffersCancel()
        expect(taskHostView()?.cancelOffered).toBe(true)
        requestTaskCancel()
        await vi.advanceTimersByTimeAsync(STREAM_HELPER_READY_TIMEOUT_MS)
        await done

        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toBeUndefined()
        expect(taskHostView()?.failure).toBeUndefined()
        expect(vi.mocked(console.error)).not.toHaveBeenCalled()
    })

    test('M15: a writer open that returns false leaves no card, no result and no alert (compatibility guard)', async () => {
        vi.spyOn(LocalWriter.prototype, 'init').mockResolvedValue(false)

        expect(await exportModuleLegacy(syntheticModule(2))).toBeNull()

        expect(taskShown()).toBe(false)
        expect(shown.filter((value) => value.type === 'normal' || value.type === 'error')).toEqual([])
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })
})
