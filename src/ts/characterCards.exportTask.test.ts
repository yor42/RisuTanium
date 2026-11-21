// @vitest-environment happy-dom

/**
 * A character-card export on the task card (S6a). The real exportCharacterCard, LocalWriter, openWebExportWriter,
 * pngChunk, CharXWriter and the real task slot run; the vendored download helper (streamSaver) is replaced by a
 * stream writer that can stop taking writes, fail or hold its ready promise, and the Tauri file system and save dialog
 * are replaced as in the desktop suites, so one harness serves the web and the desktop routes. This proves what the
 * page does, not what a browser or the native dialog does.
 *
 * Labels: each test names its class in the S6a plan. RR rows fail on the pre-card code by assertion; CG rows are
 * compatibility guards that pass before and after.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { character } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const world = vi.hoisted(() => ({
    png: new Uint8Array() as Uint8Array,
    stallAfter: Number.POSITIVE_INFINITY,
    failAfter: Number.POSITIVE_INFINITY,
    writes: [] as Uint8Array[],
    closes: 0,
    aborts: 0,
    releases: [] as Array<() => void>,
    errors: [] as string[],
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

vi.mock(import('src/ts/characters'), () => ({
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

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    readModule: vi.fn(),
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

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

// `readImage` is the one function of `globalApi.svelte` that is replaced, so the card needs no asset store.
vi.mock('src/ts/globalApi.svelte', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/globalApi.svelte')>()),
    readImage: vi.fn(async () => world.png),
    loadAsset: vi.fn(async () => new Uint8Array()),
    saveAsset: vi.fn(async () => 'saved'),
}))

//#endregion

import { exportCharacterCard } from 'src/ts/characterCards'
import { LocalWriter, VirtualWriter, readImage } from 'src/ts/globalApi.svelte'
import { busyKinds, isBusy } from 'src/ts/process/memory/busyActions'
import { alertStore } from 'src/ts/stores.svelte'
import { alertError, alertNormalWait, type alertData } from 'src/ts/alert'
import { reencodeImage } from 'src/ts/process/files/inlays'
import { exportModuleLegacy } from 'src/ts/process/modules'
import { sleep } from 'src/ts/util'
import { downloadNotice } from 'src/ts/exportNotice'
import { STREAM_HELPER_READY_TIMEOUT_MS } from 'src/ts/exportWriters'
import { ExportCancelledError } from 'src/ts/exportCancel'
import { save } from '@tauri-apps/plugin-dialog'
import {
    alertTask,
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

/** A character whose card carries three assets. */
function syntheticCharacter(): character {
    return {
        name: 'Synthetic',
        image: 'synthetic-image',
        globalLore: [],
        desc: 'd',
        firstMessage: 'hi',
        ccAssets: [1, 2, 3].map((n) => ({ type: 'x-risu-asset', uri: `assets/a${n}`, name: `asset${n}`, ext: 'png' })),
    } as unknown as character
}

/** A v2 card: only the vits files are assets (the card builder leaves emotions and additional assets out). */
function syntheticV2Character(): character {
    return {
        name: 'Synthetic V2',
        image: 'synthetic-image',
        globalLore: [],
        desc: 'd',
        firstMessage: 'hi',
        ttsMode: 'vits',
        vits: { files: { a: 'vits/a', b: 'vits/b', c: 'vits/c' } },
    } as unknown as character
}

/** A clock that advances one second per read, so every report reaches the published view at once. */
function useSteppingClock(): void {
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
}

/** The view the first time the export reaches the pause between the asset loop and the write step. */
function captureViewAtSleep(): { view: () => TaskView | null, ids: () => number[] } {
    let captured: TaskView | null = null
    const ids: number[] = []
    vi.mocked(sleep).mockImplementation(async () => {
        const view = taskHostView()
        if (view !== null) {
            ids.push(view.id)
        }
        captured ??= view
    })
    return { view: () => captured, ids: () => ids }
}

/** Records whether a task card was shown at every alertStore write and at every save-dialog call. */
function watchForCard(): { everShown: () => boolean, stop: () => void } {
    let seen = false
    const stop = alertStore.subscribe(() => { seen ||= taskShown() })
    const original = vi.mocked(save).getMockImplementation()
    vi.mocked(save).mockImplementation(async (options?: unknown) => {
        seen ||= taskShown()
        return original ? original(options) : 'chosen.bin'
    })
    return { everShown: () => seen || taskShown(), stop }
}

let shown: alertData[] = []
let unsubscribe: () => void = () => { }
const stalledWriters: Array<(error: Error) => void> = []

beforeEach(() => {
    platformBox.isTauri = false
    world.png = syntheticPng()
    world.stallAfter = Number.POSITIVE_INFINITY
    world.failAfter = Number.POSITIVE_INFINITY
    world.writes = []
    world.closes = 0
    world.aborts = 0
    world.releases = []
    world.errors = []
    stalledWriters.length = 0
    streamBox.useBlobFallback = false
    streamBox.createWriteStream = vi.fn((_filename: string) => ({
        ready: Promise.resolve(),
        writable: {
            getWriter: () => ({
                write: (data: Uint8Array) => {
                    world.writes.push(data.slice())
                    if (world.writes.length > world.failAfter) {
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
    vi.mocked(readImage).mockImplementation(async () => world.png)
    vi.mocked(save).mockClear()
    vi.mocked(alertError).mockClear()
    vi.mocked(alertNormalWait).mockClear()
    vi.mocked(exportModuleLegacy).mockClear()
    alertStore.set({ type: 'none', msg: '' })
    resetTaskHostForTests()
    shown = []
    unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return () => {
        unsubscribe()
        resetTaskHostForTests()
        vi.useRealTimers()
        vi.mocked(sleep).mockImplementation(async () => { })
        vi.restoreAllMocks()
    }
})

/** Starts a card export whose writer stops taking writes after `stallAfter`, and waits until it is stalled. */
async function stalledCardExport(stallAfter: number): Promise<{ result: Promise<boolean> }> {
    world.stallAfter = stallAfter
    const result = exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
    await vi.waitFor(() => expect(world.writes.length).toBe(stallAfter + 1))
    return { result }
}

async function waitForCancelOffered(): Promise<void> {
    await vi.waitFor(() => expect(taskHostView()?.cancelOffered).toBe(true), { timeout: 2000 })
}

describe('a card export on the task card', () => {
    test('C1: a web PNG shows one card with the steps, an asset count reaching n/n and a Cancel, and no percentage', async () => {
        useSteppingClock()
        const at = captureViewAtSleep()
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(true)

        const view = at.view()
        expect(view?.title).toBe(language.exportTaskCharacterTitle)
        expect(view?.subtitle).toBe('Synthetic')
        expect(view?.steps.map((step) => step.label)).toEqual([language.exportStepPrepare, language.exportStepAssets, language.exportStepWrite])
        expect(view?.stepIndex).toBe(1)
        expect(view?.count).toEqual({ done: 3, total: 3 })
        expect(view?.cancelOffered).toBe(true)
        expect(JSON.stringify(view)).not.toMatch(/%/)
        expect(shown.filter((value) => value.type === 'progress' || value.type === 'wait')).toEqual([])
    })

    test('C2: a Tauri PNG opens its card only after the save dialog returned, without Cancel, and never posts a progress alert', async () => {
        platformBox.isTauri = true
        const watch = watchForCard()
        let atAsset: TaskView | null = null
        vi.mocked(readImage).mockImplementation(async (key: string) => {
            if (key === 'assets/a1') {
                atAsset ??= taskHostView()
            }
            return world.png
        })
        let cardAtSave: boolean | undefined
        vi.mocked(save).mockImplementation(async () => {
            cardAtSave = taskShown()
            return 'chosen.bin'
        })
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(true)
        watch.stop()

        expect(cardAtSave).toBe(false)
        expect((atAsset as TaskView | null)?.title).toBe(language.exportTaskCharacterTitle)
        expect((atAsset as TaskView | null)?.cancelOffered).toBe(false)
        expect(shown.filter((value) => value.type === 'progress')).toEqual([])
    })

    test('C3: a Cancel on the card of a stalled web export ends it cancelled with the incomplete-file line and no legacy notice', async () => {
        const { result } = await stalledCardExport(2)
        await waitForCancelOffered()
        requestTaskCancel()

        expect(await result).toBe(false)
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
        expect(shown.filter((value) => value.type === 'normal' || value.type === 'error')).toEqual([])
        expect(world.errors).toEqual([])
    })

    test('C4: a dismissed save target leaves no card and no result (compatibility guard)', async () => {
        vi.spyOn(LocalWriter.prototype, 'init').mockResolvedValue(false)
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(false)

        expect(taskShown()).toBe(false)
        expect(taskResultShowing()).toBe(false)
        expect(world.errors).toEqual([])
    })

    test('C5: a web failure after the stream opened aborts once and shows one fail detail with the incomplete-file sentence', async () => {
        world.failAfter = 2
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(false)

        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('synthetic stream failure\n' + language.exportFailedFileIncomplete)
        expect(world.aborts).toBe(1)
        expect(world.errors).toEqual([])
    })

    test('C5b: a Tauri failure that is a plain object, before any file call, shows its JSON and logs the object', async () => {
        platformBox.isTauri = true
        const thrown = { code: 7 }
        vi.mocked(readImage).mockImplementation(async (key: string) => {
            if (key === 'assets/a2') {
                throw thrown
            }
            return world.png
        })
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(false)

        expect(taskHostView()?.failure?.detail).toBe('{"code":7}')
        expect(console.error).toHaveBeenCalledWith(thrown)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })

    test('C6: success resolves while the result card is showing, with the download sentence, and the export is no longer busy', async () => {
        const result = await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })

        expect(result).toBe(true)
        expect(taskResultShowing()).toBe(true)
        expect(taskHostView()?.result?.headline).toBe(language.exportTaskDone)
        expect(taskHostView()?.result?.summary).toEqual([downloadNotice(language.successExport)])
        expect(isBusy()).toBe(false)
        expect(shown.filter((value) => value.type === 'normal')).toEqual([])
    })

    test('C8 (a): a Realm VirtualWriter run keeps its legacy dialogs and never shows a card', async () => {
        const watch = watchForCard()
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3', writer: new VirtualWriter() })).toBe(true)
        watch.stop()

        expect(watch.everShown()).toBe(false)
        expect(shown.some((value) => value.type === 'progress' || value.type === 'wait')).toBe(true)
        expect(shown.filter((value) => value.type === 'normal' || value.type === 'error')).toEqual([])
    })

    test('C8 (b): a caller-supplied LocalWriter without a card keeps the cancellable gate and never shows a card', async () => {
        const writer = new LocalWriter()
        await writer.init('x', ['charx'])
        const watch = watchForCard()
        expect(await exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3', writer })).toBe(true)
        watch.stop()

        expect(watch.everShown()).toBe(false)
        expect(shown.some((value) => value.type === 'wait' && value.onCancel !== undefined)).toBe(true)
        expect(shown.filter((value) => value.type === 'normal' || value.type === 'error')).toEqual([])
    })

    test('C8 (c): the gate Cancel of a stalled caller-supplied LocalWriter ends it with the legacy incomplete-file notice once, never a card', async () => {
        const writer = new LocalWriter()
        await writer.init('x', ['charx'])
        const watch = watchForCard()
        world.stallAfter = world.writes.length + 1
        const result = exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3', writer })
        await vi.waitFor(() => expect(world.writes.length).toBe(world.stallAfter + 1), { timeout: 2000 })
        const dialog = get(alertStore) as alertData
        expect(dialog.onCancel).toBeTypeOf('function')
        dialog.onCancel?.()

        expect(await result).toBe(false)
        watch.stop()
        expect(shown.filter((value) => value.msg === language.exportCancelledFileIncomplete)).toHaveLength(1)
        expect(watch.everShown()).toBe(false)
    })

    test('C9: a v2 PNG counts the vits files out of the run total', async () => {
        useSteppingClock()
        const at = captureViewAtSleep()
        expect(await exportCharacterCard(syntheticV2Character(), 'png', { spec: 'v2' })).toBe(true)

        expect(at.view()?.count).toEqual({ done: 3, total: 3 })
        expect(at.view()?.stepIndex).toBe(1)
    })

    test('C10: the bytes of an export on the card equal those of the same card on the legacy route (byte identity guard)', async () => {
        // The card embeds a seconds-resolution modification date; a real clock can cross a second between the two exports.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const fileOf = async (arg: { writer?: LocalWriter }) => {
            world.writes = []
            await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3', ...arg })
            return Buffer.concat(world.writes)
        }
        const onCard = await fileOf({})
        const writer = new LocalWriter()
        await writer.init('x', ['png'])
        world.writes = []
        const legacy = await fileOf({ writer })

        expect(onCard.length).toBeGreaterThan(0)
        expect(onCard.equals(legacy)).toBe(true)
    })

    test('C11: a CharX card export hands the embedded module.risum no writer, no wait and no second card', async () => {
        useSteppingClock()
        const at = captureViewAtSleep()
        expect(await exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3' })).toBe(true)

        expect(vi.mocked(exportModuleLegacy)).toHaveBeenCalledWith(expect.anything(), { alertEnd: false, saveData: false })
        expect(new Set(at.ids()).size).toBe(1)
        expect(shown.filter((value) => value.type === 'wait')).toEqual([])
    })

    test('C12: a card replaced by a newer task, then failing with a kept file, posts the legacy error once and leaves the newer card', async () => {
        const { result } = await stalledCardExport(2)
        alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
        stalledWriters.forEach((reject) => reject(new Error('synthetic stream failure')))

        expect(await result).toBe(false)
        expect(world.errors).toEqual(['synthetic stream failure\n' + language.exportFailedFileIncomplete])
        expect(taskHostView()?.title).toBe('Newer task')
    })

    test('C13: a Cancel while the web helper has not answered ends cancelled after the helper timeout, with no notice and no logged cancel', async () => {
        vi.useFakeTimers()
        streamBox.createWriteStream = vi.fn((_filename: string) => ({
            ready: new Promise<void>(() => { }),
            writable: { getWriter: () => ({ write: async () => { }, close: async () => { }, abort: async () => { world.aborts += 1 } }) },
        }))
        const result = exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        await vi.advanceTimersByTimeAsync(0)
        expect(taskHostView()?.cancelOffered).toBe(true)
        requestTaskCancel()
        expect(taskHostView()?.state).toBe('cancelling')
        await vi.advanceTimersByTimeAsync(STREAM_HELPER_READY_TIMEOUT_MS)

        expect(await result).toBe(false)
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toBeUndefined()
        expect(vi.mocked(alertNormalWait)).not.toHaveBeenCalledWith(language.exportHelperNotResponding)
        expect(vi.mocked(console.error).mock.calls.some((call) => call[0] instanceof ExportCancelledError)).toBe(false)
    })

    test('C14: a rejected Tauri save dialog call ends as the legacy error, never a card (compatibility guard)', async () => {
        platformBox.isTauri = true
        const failure = new Error('dialog plugin failed')
        const watch = watchForCard()
        vi.mocked(save).mockRejectedValueOnce(failure)

        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(false)
        watch.stop()

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe(failure)
        expect(watch.everShown()).toBe(false)
        expect(shown.filter((value) => value.type === 'progress' || value.type === 'wait')).toEqual([])
    })

    test('C15: a Tauri image re-encode failure before the dialog ends as the legacy error, never a card (compatibility guard)', async () => {
        platformBox.isTauri = true
        const failure = new Error('reencode failed')
        const watch = watchForCard()
        vi.mocked(reencodeImage).mockRejectedValueOnce(failure)

        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(false)
        watch.stop()

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe(failure)
        expect(vi.mocked(save)).not.toHaveBeenCalled()
        expect(watch.everShown()).toBe(false)
    })

    test.each([false, true])('C16: a preflight that throws ends as the legacy error, never a card (compatibility guard; tauri=%s)', async (tauri) => {
        platformBox.isTauri = tauri
        const failure = new Error('preflight read failed')
        const char = syntheticCharacter()
        Object.defineProperty(char, 'globalLore', { get() { throw failure } })
        const watch = watchForCard()

        expect(await exportCharacterCard(char, 'png', { spec: 'v3' })).toBe(false)
        watch.stop()

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError).mock.calls[0][0]).toBe(failure)
        expect(watch.everShown()).toBe(false)
    })

    test('C17: a web image re-encode failure after the card opened ends as a fail card', async () => {
        vi.mocked(reencodeImage).mockRejectedValueOnce(new Error('reencode failed'))

        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(false)

        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('reencode failed')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })

    test('C18: a web writer open that rejects ends as a fail card', async () => {
        streamBox.createWriteStream = vi.fn(() => { throw new Error('open failed') })

        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(false)

        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('open failed')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(busyKinds()).not.toContain('export')
    })
})
