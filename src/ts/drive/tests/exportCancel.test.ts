// @vitest-environment happy-dom

/**
 * The Cancel of a web backup export. The real `SaveLocalBackup`, `exportThisTabBackup`, `LocalWriter`,
 * `openWebExportWriter` and alert module run; only the vendored download helper (`streamSaver`) is replaced by a
 * stream writer that can stop taking writes, which is what a browser that ended its download early looks like to the
 * page: the page's own `write` or `close` never settles and `abort` waits behind it. This proves what the page does,
 * not what a browser does with the download.
 *
 * Labels: (R) reproducer, fails on the code before the Cancel existed because the dialog on screen at the stall has
 * no `onCancel`; (N) new behaviour; (G) guard, passes with or without the change.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import { deflateSync } from 'fflate'
import type { Database } from 'src/ts/storage/database.svelte'
import type { MintedStubEntry } from 'src/ts/drive/exportInline'
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
    readyGate: null as Promise<void> | null,
    notices: [] as string[],
    collectGate: null as Promise<void> | null,
    collectUnavailable: [] as string[],
    /** Unit entries minted for stubs, as the collection reports them; empty means the collection's own answer. */
    stubEntries: new Map<string, MintedStubEntry>(),
    storeTypeAtConfirm: [] as string[],
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
            const withStubs = world.stubEntries.size > 0 ? { ...collected, stubEntries: new Map(world.stubEntries) } : collected
            return world.collectUnavailable.length > 0 ? { ...withStubs, unavailableKeys: [...world.collectUnavailable] } : withStubs
        }),
    }
})

// The assets are listed and read through the page's byte store; `world.files` is what it holds.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    return appStoreModuleOver(() => forageOverMap(world.files)) as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { SaveLocalBackup, exportThisTabBackup } from 'src/ts/drive/backuplocal'
import type { ExportOutcome } from 'src/ts/drive/operationEnd'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { alertStore } from 'src/ts/stores.svelte'
import { alertError } from 'src/ts/alert'
import { collectColdStorageBackupPayloads } from 'src/ts/process/coldstorage.svelte'
import { ExportCancelToken, createExportWaitGate } from 'src/ts/exportCancel'
import type { alertData } from 'src/ts/alert'
import { writeFile } from '@tauri-apps/plugin-fs'

const bytes = (text: string) => new TextEncoder().encode(text)

/** Every value the alert store held since the test began. */
let shown: alertData[] = []
let unsubscribe: () => void = () => { }

beforeEach(() => {
    platformBox.isTauri = false
    world.confirm = []
    world.confirmAnswer = true
    world.stallAfter = Number.POSITIVE_INFINITY
    world.writes = []
    world.closes = 0
    world.aborts = 0
    world.created = 0
    world.releases = []
    world.helperAnswers = true
    world.closeStalls = false
    world.readyGate = null
    world.notices = []
    world.collectGate = null
    world.collectUnavailable = []
    world.stubEntries = new Map()
    world.storeTypeAtConfirm = []
    world.readStoreType = () => get(alertStore).type
    streamBox.useBlobFallback = false
    streamBox.createWriteStream = vi.fn((_filename: string) => {
        world.created += 1
        return {
            ready: world.readyGate ?? (world.helperAnswers ? Promise.resolve() : new Promise<void>(() => { })),
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
                        return world.closeStalls ? new Promise<void>(() => { }) : Promise.resolve()
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
    shown = []
    unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    vi.mocked(alertError).mockClear()
    return () => {
        unsubscribe()
        vi.useRealTimers()
        vi.restoreAllMocks()
    }
})

/** Starts a partial export that stops accepting writes after `stallAfter`, and waits until it is stalled. */
async function stalledPartialExport(stallAfter: number): Promise<{ outcome: Promise<ExportOutcome> }> {
    world.stallAfter = stallAfter
    const outcome = exportThisTabBackup()
    await vi.waitFor(() => expect(world.writes.length).toBe(stallAfter + 1))
    return { outcome }
}

function pressCancel(): void {
    const dialog = get(alertStore) as alertData
    expect(dialog.type).toBe('wait')
    expect(dialog.onCancel).toBeTypeOf('function')
    dialog.onCancel?.()
}

/** i.waitFor polls on a timer, which a test that fakes timers has stopped; this lets the export run to the helper wait instead. */
async function untilCreatedUnderFakeTimers(): Promise<void> {
    for (let i = 0; i < 200 && world.created < 1; i++) {
        await vi.advanceTimersByTimeAsync(0)
    }
    expect(world.created).toBe(1)
}

const settleTicks = async () => {
    for (let i = 0; i < 6; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

describe('a partial backup stalled mid-write', () => {
    test('(R) the dialog on screen at the stall carries a Cancel, and pressing it ends the export as cancelled', async () => {
        const { outcome } = await stalledPartialExport(1)

        const dialog = get(alertStore) as alertData
        expect(dialog.type).toBe('wait')
        expect(dialog.onCancel).toBeTypeOf('function')
        dialog.onCancel?.()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
    })

    test('(N) a cancel after the stream opened says any saved file is incomplete, once, and reports no failure', async () => {
        const { outcome } = await stalledPartialExport(1)

        pressCancel()
        await outcome

        const notice = get(alertStore) as alertData
        expect(notice.type).toBe('normal')
        expect(notice.msg).toBe(language.backupCancelledFileIncomplete)
        expect(shown.filter((value) => value.msg === language.backupCancelledFileIncomplete)).toHaveLength(1)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(world.aborts).toBe(1)
        expect(world.closes).toBe(0)
        expect(busyKinds()).not.toContain('backupSave')
    })

    test('(N) Cancel pressed twice (Back or Escape after the button) is the same single cancel', async () => {
        const { outcome } = await stalledPartialExport(1)
        const dialog = get(alertStore) as alertData

        dialog.onCancel?.()
        dialog.onCancel?.()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        expect(shown.filter((value) => value.msg === language.backupCancelledFileIncomplete)).toHaveLength(1)
        expect(world.aborts).toBe(1)
    })

    test('(N) a write that settles after the cancel posts nothing, closes nothing and reports no success', async () => {
        const { outcome } = await stalledPartialExport(1)
        pressCancel()
        await outcome
        const seen = shown.length

        for (const release of world.releases) {
            release()
        }
        await settleTicks()

        expect(shown).toHaveLength(seen)
        expect(world.closes).toBe(0)
        expect(world.writes).toHaveLength(2)
    })

    test('(N) a cancel when the first write is the one that stalls still warns: the browser download had already started with zero bytes written', async () => {
        const { outcome } = await stalledPartialExport(0)
        pressCancel()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        expect((get(alertStore) as alertData).msg).toBe(language.backupCancelledFileIncomplete)
    })

    test('(N) a stall while a stub unit entry is written shows the Cancel too', async () => {
        const unit = '0123abcdefghijklmnopqrstuv'
        const stubBody = bytes('stub-unit-entry-body')
        const db = world.db as { characters: Array<Record<string, unknown>> }
        db.characters = [{ chaId: 'a', name: 'A', type: 'character', chatPage: 0, chats: [], image: 'assets/profile.png', coldstorage: unit }]
        world.stubEntries = new Map([[`${unit}\u0000a`, { uuid: 'minted-uuid', name: 'A', backupName: 'minted-uuid', rawLength: stubBody.length, packed: deflateSync(stubBody, { level: 1 }) }]])

        // An unstalled run shows which write carries the stub entry (header and body travel as one write); the second run stops taking writes there.
        expect((await exportThisTabBackup()).status).toBe('saved')
        const stubWrite = world.writes.findIndex((data) => new TextDecoder().decode(data).endsWith('stub-unit-entry-body'))
        expect(stubWrite).toBeGreaterThan(0)
        world.writes = []
        world.closes = 0

        const { outcome } = await stalledPartialExport(stubWrite)
        const dialog = get(alertStore) as alertData
        expect(dialog.msg).toContain('Cold data')
        expect(dialog.onCancel).toBeTypeOf('function')
        dialog.onCancel?.()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
    })

    test('(N) the stalled close of a finished export can be cancelled too', async () => {
        world.closeStalls = true
        const outcome = exportThisTabBackup()
        // Every write settles; the close is the call that never settles.
        await vi.waitFor(() => expect(world.closes).toBe(1))
        pressCancel()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
    })
})

describe('a cancel before the stream opened', () => {
    test('(N) a cancel during the cold-storage collection settles without asking anything and opens no writer', async () => {
        let letCollectionFinish: () => void = () => { }
        world.collectGate = new Promise<void>((resolve) => { letCollectionFinish = resolve })
        world.collectUnavailable = ['unit-that-is-gone']
        const outcome = exportThisTabBackup()
        await vi.waitFor(() => expect((get(alertStore) as alertData).type).toBe('wait'))

        pressCancel()
        letCollectionFinish()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'untouched' })
        expect(world.confirm).toEqual([])
        expect(world.created).toBe(0)
        // The Cancel replaces the wait itself: with no notice to post, nothing is left on screen.
        expect((get(alertStore) as alertData).type).toBe('none')
    })

    test('(N) a cancel during the helper wait shows no helper notice, downloads nothing and warns of no file', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        world.helperAnswers = false
        const createObjectURL = vi.spyOn(URL, 'createObjectURL')
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })
        const outcome = exportThisTabBackup()
        await untilCreatedUnderFakeTimers()

        pressCancel()
        await vi.advanceTimersByTimeAsync(10_000)

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'untouched' })
        expect(world.notices).toEqual([])
        expect(createObjectURL).not.toHaveBeenCalled()
        expect(click).not.toHaveBeenCalled()
        expect(world.writes).toEqual([])
        // The Cancel replaces the wait itself: with no notice to post, nothing is left on screen.
        expect((get(alertStore) as alertData).type).toBe('none')
    })

    test('(N) a cancel while a download-in-memory writer is stalled warns of no file: nothing reached the browser', async () => {
        streamBox.useBlobFallback = true
        const { outcome } = await stalledPartialExport(1)

        pressCancel()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'untouched' })
        expect(world.notices).toEqual([language.exportHeldInMemory])
        // The Cancel replaces the wait itself: with no notice to post, nothing is left on screen.
        expect((get(alertStore) as alertData).type).toBe('none')
    })
})

describe('a cancel while the writer opens', () => {
    test('(N) a cancel that comes before the helper answers ends the export before the database is encoded, and warns: the stream had opened', async () => {
        // No assets, so no loop checkpoint stands between the writer's opening and the database encode.
        world.db = { characters: [], personas: [], characterOrder: [], botPresets: [] }
        let helperAnswers: () => void = () => { }
        world.readyGate = new Promise<void>((resolve) => { helperAnswers = resolve })
        const outcome = exportThisTabBackup()
        await vi.waitFor(() => expect(world.created).toBe(1))
        const collectionsBefore = vi.mocked(collectColdStorageBackupPayloads).mock.calls.length

        pressCancel()
        helperAnswers()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        expect(vi.mocked(collectColdStorageBackupPayloads).mock.calls.length).toBe(collectionsBefore)
        expect(world.writes).toEqual([])
        expect(world.aborts).toBe(1)
    })
})

describe('a cancel while the writer of a full backup opens', () => {
    test('(N) a cancel that comes before the helper answers ends the export before the store is listed for inlays', async () => {
        // No asset and no character, so no loop checkpoint stands between the writer's opening and the inlay pass.
        world.db = { characters: [], personas: [], characterOrder: [], botPresets: [] }
        world.files = new Map()
        let helperAnswers: () => void = () => { }
        world.readyGate = new Promise<void>((resolve) => { helperAnswers = resolve })
        const outcome = SaveLocalBackup()
        await vi.waitFor(() => expect(world.created).toBe(1))
        const storeReads = [vi.spyOn(world.files, 'get'), vi.spyOn(world.files, 'keys'), vi.spyOn(world.files, 'has')]
        const readsSoFar = () => storeReads.reduce((total, spy) => total + spy.mock.calls.length, 0)
        const before = readsSoFar()

        pressCancel()
        helperAnswers()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        expect(readsSoFar()).toBe(before)
        expect(world.writes).toEqual([])
    })
})

describe('the wait gate of an export', () => {
    test('(N) after a cancel the gate posts nothing, and clearing removes only the wait the gate itself put up', () => {
        const token = new ExportCancelToken()
        const gate = createExportWaitGate(token, true)

        gate.wait('first')
        expect((get(alertStore) as alertData).msg).toBe('first')
        alertStore.set({ type: 'normal', msg: 'someone else' })
        gate.clear()
        expect((get(alertStore) as alertData).msg).toBe('someone else')

        token.cancel()
        gate.wait('after the cancel')
        expect((get(alertStore) as alertData).msg).toBe('someone else')
    })

    test('(N) each wait carries the Cancel, and a gate that is not cancellable carries none', () => {
        const cancellable = createExportWaitGate(new ExportCancelToken(), true)
        cancellable.wait('one')
        cancellable.wait('two')
        const plain = createExportWaitGate(new ExportCancelToken(), false)
        plain.wait('three')

        expect(shown.filter((value) => value.type === 'wait').map((value) => [value.msg, value.onCancel !== undefined])).toEqual([
            ['one', true], ['two', true], ['three', false],
        ])
    })
})

describe('the wait before each prompt', () => {
    test('(N) the export takes its own cancellable wait off the screen before it asks about unavailable data', async () => {
        world.collectUnavailable = ['unit-that-is-gone']

        const outcome = await exportThisTabBackup()

        expect(outcome.status).toBe('saved')
        expect(world.storeTypeAtConfirm).toEqual(['none'])
    })

    test('(N) a prompt that is not asked leaves the wait, and its Cancel, on the screen through the helper wait', async () => {
        world.helperAnswers = false
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        void exportThisTabBackup()
        await untilCreatedUnderFakeTimers()

        expect((get(alertStore) as alertData).onCancel).toBeTypeOf('function')
    })
})

describe('a full backup', () => {
    test('(R) the dialog on screen at the stall carries a Cancel, and the lock of the inlay being written is released', async () => {
        const { getAppStore } = await import('src/ts/storage/store/appStore')
        const { writeAppInlay, withInlayLock } = await import('src/ts/process/files/inlayStore')
        const store = await getAppStore()
        await withInlayLock('stalled-inlay.png', () => writeAppInlay(store, 'stalled-inlay.png', {
            ...{ ext: 'png', name: 'stalled.png', type: 'image', width: 1, height: 1 } as Record<string, unknown>,
            data: new Blob([bytes('inlay-body')], { type: 'image/png' }),
        }))
        // The three assets are written, then the first write of the inlay entry stalls while it holds the inlay's lock.
        world.stallAfter = 3
        const outcome = SaveLocalBackup()
        await vi.waitFor(() => expect(world.writes.length).toBe(4))

        const dialog = get(alertStore) as alertData
        expect(dialog.type).toBe('wait')
        expect(dialog.onCancel).toBeTypeOf('function')
        dialog.onCancel?.()

        expect(await outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        const lockFree = await Promise.race([
            withInlayLock('stalled-inlay.png', async () => 'free'),
            new Promise<string>((resolve) => setTimeout(() => resolve('still held'), 500)),
        ])
        expect(lockFree).toBe('free')
    })
})

describe('guards', () => {
    test('(G) a normal export is unchanged: it closes the file and ends saved', async () => {
        const outcome = await exportThisTabBackup()

        expect(outcome.status).toBe('saved')
        expect(world.closes).toBe(1)
        expect(world.aborts).toBe(0)
        expect((get(alertStore) as alertData).type).toBe('normal')
        expect((get(alertStore) as alertData).msg).not.toBe(language.backupCancelledFileIncomplete)
    })

    test('(G) a desktop export shows no Cancel on any dialog', async () => {
        platformBox.isTauri = true
        vi.mocked(writeFile).mockImplementationOnce(() => new Promise<void>(() => { }))
        void exportThisTabBackup()
        await vi.waitFor(() => expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1))

        expect(shown.filter((value) => value.type === 'wait').length).toBeGreaterThan(0)
        expect(shown.filter((value) => value.type === 'wait' && value.onCancel !== undefined)).toEqual([])
    })
})
