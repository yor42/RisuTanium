/**
 * The import Undo on a stable `$state` database: what pressing "Undo import" on the result card changes, driven through
 * `runImportBatch`, `answerTask` and the real `importModule`.
 *
 * REAL here: `importBatch.ts`, `importUndo.ts`, `alertTask.svelte.ts`, `characters.ts` (the trash writes), `globalApi.svelte.ts`
 * (`checkCharOrder`), the save marks, the database change effects, `modules.ts` (`importModule`, `commitModule`) and a real
 * `$state` database whose root object stays the same until a test replaces it. MOCKED: stores other than `DBState`, alerts,
 * the toast host (a recorder), `bootWindow` (a recorder), asset and RPack seams. A mocked store says nothing about native
 * storage.
 *
 * Titles: "reproducer" fails on the code before the change for the named assertion; "guard" passes before (or only
 * fails there because no Undo exists) and pins an invariant.
 */
import { flushSync } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    cleanup: vi.fn(),
    onMark: null as null | (() => void),
    files: [] as File[],
    toasts: [] as { kind?: string, text: string }[],
    marks: 0,
    refreshes: 0,
    storeCalls: [] as string[],
    onConfirm: null as null | (() => void),
    selectAnswer: '0',
}))

//#region module mocks

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock('uuid', () => {
    let n = 0
    return { v4: () => `uuid-${++n}` }
})

vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDBState: unknown }).__testDBState),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    saveImage: vi.fn(),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    setCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
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
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => { h.onConfirm?.(); return true }),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => h.selectAnswer),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/toast/toastHost.svelte'), () => ({
    postToast: vi.fn((init: { kind?: string, text: string }) => { h.toasts.push(init); return 1 }),
}) as unknown as typeof import('src/ts/toast/toastHost.svelte'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(() => { h.marks += 1; h.onMark?.() }),
}) as unknown as typeof import('src/ts/bootWindow'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    checkPersonaBinded: vi.fn(),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
    selectFileByDom: vi.fn(async () => h.files),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }))
vi.mock('streamsaver', () => ({ default: {} }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))

vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => {}) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => {}) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({ hasher: vi.fn((s: string) => s), parseMarkdownSafe: vi.fn() }) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({ characterURLImport: vi.fn(), importCharacter: vi.fn(), importCharacterFile: vi.fn(), exportCharacterCard: vi.fn(), hubURL: 'https://example.invalid' }) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => {})
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn(), compressImage: vi.fn(async (d: Uint8Array) => d) }) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/process/inlayScreen'), () => ({ updateInlayScreen: vi.fn() }) as unknown as typeof import('src/ts/process/inlayScreen'))
vi.mock(import('src/ts/translator/translator'), () => ({ translateHTML: vi.fn() }) as unknown as typeof import('src/ts/translator/translator'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/pngChunk'), () => ({ PngChunk: class {} }) as unknown as typeof import('src/ts/pngChunk'))
vi.mock(import('src/ts/media/avatarThumb'), () => ({ getAvatarThumbSrc: vi.fn(), isThumbEligible: vi.fn(() => false) }) as unknown as typeof import('src/ts/media/avatarThumb'))
vi.mock(import('src/ts/caughtErrors'), async (importOriginal) => ({ ...(await importOriginal()), recordCaughtError: vi.fn() }))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({ convertExternalLorebook: vi.fn(() => []) }) as unknown as typeof import('src/ts/process/lorebook.svelte'))
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))
vi.mock(import('src/ts/interchangeability'), () => ({ convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn() }) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/process/moduleGuiBump'), () => ({ bumpModuleGui: vi.fn(), holdModuleGuiBumps: vi.fn(() => () => {}) }))
vi.mock(import('src/ts/process/files/inlayCleanup'), () => ({ queueInlayCleanupForChat: h.cleanup, queueInlayCleanupForCharacters: h.cleanup }) as unknown as typeof import('src/ts/process/files/inlayCleanup'))
vi.mock(import('src/ts/storage/assetDeleteHold'), () => ({ holdAssetDeletion: h.cleanup }) as unknown as typeof import('src/ts/storage/assetDeleteHold'))
vi.mock('src/ts/process/moduleLoader', () => ({ loadModuleStubsOf: vi.fn(async () => {}) }))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { backgroundTask, answerTask, confirmTask, taskConfirmShowing, type TaskToastPresenter, alertTask, resetTaskHostForTests, setTaskClockForTests, setTaskToastPresenter, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import { runImportBatch, type ImportItem, type ImportOutcome } from 'src/ts/importBatch'
import type { ImportProgress } from 'src/ts/importProgress'
import { requestTaskCancel } from 'src/ts/alertTask.svelte'
import { importModule } from 'src/ts/process/modules'
import { restoreCharacterFromTrash } from 'src/ts/characters'
import { beginRestoreRun, resetRestoreInProgressForTests } from 'src/ts/drive/restoreInProgress'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import { risumBytes } from 'src/ts/process/tests/risumFixtures'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { TaskClock } from 'src/lib/Nexus/pattern/taskProgress'
import { language } from 'src/lang'

//#region fixtures

type Ch = Database['characters'][number]
type Mod = Database['modules'][number]

const mk = (chaId: string, trashTime?: number): Ch => ({
    chaId, name: chaId, type: 'character', chatPage: 0,
    chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    trashTime,
}) as unknown as Ch

const TASK = { title: 'Importing', steps: ['read', 'check', 'assets', 'add'] as const }
const ok: ImportOutcome = { kind: 'imported', index: null }
const item = (name: string, run: (progress: ImportProgress) => Promise<ImportOutcome>): ImportItem => ({ name, run })

function install(chars: Ch[] = [], modules: Mod[] = [], order: string[] = []): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules, enabledModules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: order, characters: chars,
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    selectedCharID.set(-1)
}

/** A character the import adds: pushed into the live list and reported with the slot read right after the push. */
function addCharacter(progress: ImportProgress, chaId: string): Ch {
    DBState.db.characters.push(mk(chaId))
    DBState.db.characterOrder.push(chaId)
    const slot = DBState.db.characters[DBState.db.characters.length - 1]
    progress.committed({ kind: 'character', slot })
    return slot
}

const chars = (): Ch[] => DBState.db.characters
const listed = (chaId: string): Ch => chars().find((c) => c.chaId === chaId)!
const actionIds = (): string[] => (taskHostView()?.result?.actions ?? taskHostView()?.failure?.actions ?? []).map((a) => a.id)

async function untilResult(done: Promise<unknown>): Promise<boolean> {
    let ended = false
    void done.then(() => { ended = true })
    for (let i = 0; i < 400 && !ended && !taskResultShowing(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return taskResultShowing()
}

let tracker: toSaveType
let marks: string[]
let cleanup: (() => void) | undefined
let presenterCalls: { posted: number, updates: { actions: string[] }[], on: { open(): void, end(): void }[] }

beforeEach(() => {
    h.files = []
    h.toasts = []
    h.marks = 0
    h.onConfirm = null
    h.selectAnswer = '0'
    h.onMark = null
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    resetCharacterSaveMarksForTest()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false } as unknown as toSaveType
    marks = []
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    install()
    presenterCalls = { posted: 0, updates: [], on: [] }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    resetTaskHostForTests()
    resetRestoreInProgressForTests()
    selectedCharID.set(-1)
    vi.restoreAllMocks()
})

//#endregion

describe('the Undo action on the result card', () => {
    test('T1 reproducer: a finish card of an import that added a character lists a guarded Undo', async () => {
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.result?.actions).toEqual([{ id: 'undo', label: language.importTaskUndo, guarded: true }])
        answerTask({ kind: 'ok' })
        await done
    })

    test('T2/T3 reproducer: Undo trashes every imported character, marks it for saving, drops it from the order and says so', async () => {
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async (p) => { addCharacter(p, 'B'); return ok }),
            item('c', async (p) => { addCharacter(p, 'C'); return ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        tracker.character = []
        answerTask({ kind: 'action', id: 'undo' })
        const summary = await done
        expect(summary.undone).toBe(true)
        for (const id of ['A', 'B', 'C']) {
            expect(listed(id).trashTime, `${id} is in the Trash`).toBeTypeOf('number')
            expect(tracker.character, `${id} is marked for saving`).toContain(id)
            expect($state.snapshot(DBState.db.characterOrder)).not.toContain(id)
        }
        expect(h.toasts).toEqual([{ kind: 'info', text: 'Moved 3 to the Trash', cue: 'undo' }])
        //A9: an undone character is restorable.
        expect(() => restoreCharacterFromTrash(listed('A'))).not.toThrow()
        expect(listed('A').trashTime).toBeUndefined()
    })

    test('T4/M32 reproducer: Undo removes the module the import added and leaves enabledModules alone', async () => {
        h.files = [new File([risumBytes({ module: { name: 'Mod One' } })], 'one.risum')]
        const done = importModule()
        expect(await untilResult(done)).toBe(true)
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Mod One'])
        expect(actionIds()).toEqual(['undo'])
        DBState.db.enabledModules = ['other-id']
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(DBState.db.modules).toEqual([])
        expect($state.snapshot(DBState.db.enabledModules)).toEqual(['other-id'])
        expect(h.toasts[0].text).toBe('Removed 1 module')
    })

    test('T3 reproducer: the module and character writes reach the database change effects', async () => {
        const scheduled = vi.fn()
        const markChanged = vi.fn()
        installCharacterSaveMarks({ tracker, schedule: scheduled })
        install([], [], [])
        cleanup = $effect.root(() => { registerDbChangeEffects({ tracker, markChanged }) })
        flushSync()
        h.files = [new File([risumBytes({ module: { name: 'Mod One' } })], 'one.risum')]
        const done = importModule()
        expect(await untilResult(done)).toBe(true)
        flushSync()
        tracker.modules = false
        markChanged.mockClear()
        answerTask({ kind: 'action', id: 'undo' })
        await done
        flushSync()
        expect(tracker.modules, 'the module list is dirty after the undo').toBe(true)
    })

    test('T5 guard: an outside module with the same id and an outside character with the same chaId are untouched', async () => {
        const outsideChar = mk('A')
        install([outsideChar], [{ id: 'uuid-shared', name: 'Outside' } as unknown as Mod], ['A'])
        let importedSlot: Ch | undefined
        const done = runImportBatch([item('a', async (p) => { importedSlot = addCharacter(p, 'A'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(importedSlot?.trashTime).toBeTypeOf('number')
        expect(chars()[0].trashTime, 'the outside twin keeps its state').toBeUndefined()
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Outside'])
    })

    test('T5 guard: a module whose id equals an outside module is removed by reference, and enabledModules keeps an id another module still carries', async () => {
        const outside = { id: 'dup', name: 'Outside' } as unknown as Mod
        install([], [outside], [])
        DBState.db.enabledModules = ['dup']
        const done = runImportBatch([item('m', async (p) => {
            DBState.db.modules.push({ id: 'dup', name: 'Added' } as unknown as Mod)
            p.committed({ kind: 'module', slot: DBState.db.modules[DBState.db.modules.length - 1] })
            return ok
        })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Outside'])
        expect($state.snapshot(DBState.db.enabledModules)).toEqual(['dup'])
    })

    test('T6 guard (defensive): a stub swapped for a live object with the same chaId is trashed; so is a live slot swapped for a stub', async () => {
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async (p) => { addCharacter(p, 'B'); return ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        const aAt = chars().findIndex((c) => c.chaId === 'A')
        const bAt = chars().findIndex((c) => c.chaId === 'B')
        chars()[aAt] = mk('A')
        chars()[bAt] = { chaId: 'B', name: 'B', coldstorage: 'unit-b', type: 'character' } as unknown as Ch
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(chars()[aAt].trashTime).toBeTypeOf('number')
        expect(chars()[bAt].trashTime).toBeTypeOf('number')
    })

    test('T7 reproducer: a Retry round adds B; Undo trashes both A and B', async () => {
        let tries = 0
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async (p) => {
                tries += 1
                if (tries === 1) return { kind: 'failed', error: 'x' }
                addCharacter(p, 'B')
                return ok
            }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(actionIds()).toEqual(['undo', 'retry'])
        answerTask({ kind: 'action', id: 'retry' })
        expect(await untilResult(done)).toBe(true)
        expect(actionIds()).toEqual(['undo'])
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(listed('A').trashTime).toBeTypeOf('number')
        expect(listed('B').trashTime).toBeTypeOf('number')
    })

    test('T20 reproducer: a Retry round that fails still offers Undo for the earlier round, and pressing it trashes A', async () => {
        let tries = 0
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async () => { tries += 1; return { kind: 'failed', error: 'x' } }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.failure?.headline).toBe(language.importTaskFailedOne('b'))
        expect(actionIds()).toEqual(['undo', 'retry'])
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(tries).toBe(2)
        expect(listed('A').trashTime).toBeTypeOf('number')
    })

    test('T21 guard: a silent close of a Retry round posts nothing and A stays', async () => {
        let tries = 0
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async () => { tries += 1; return tries === 1 ? { kind: 'failed', error: 'x' } : { kind: 'skipped' } }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        const summary = await done
        expect(summary.undone).toBeUndefined()
        expect(taskHostView()).toBeNull()
        expect(listed('A').trashTime).toBeUndefined()
    })

    test('T26 reproducer: a cancelled Retry round still offers Undo for round 0, and pressing it trashes A', async () => {
        let tries = 0
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async (p) => {
                tries += 1
                if (tries === 1) return { kind: 'failed', error: 'x' }
                requestTaskCancel()
                p.beforeWrite()
                return ok
            }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        expect(await untilResult(done)).toBe(true)
        const view = taskHostView()!
        expect(view.cancelled).toBe(true)
        expect(view.result?.summary).toBeUndefined()
        expect(actionIds()).toEqual(['undo'])
        answerTask({ kind: 'action', id: 'undo' })
        const summary = await done
        expect(summary.cancelled).toBe(true)
        expect(summary.undone).toBe(true)
        expect(listed('A').trashTime).toBeTypeOf('number')
    })

    test('T27 reproducer: a round-0 failure after commits offers Undo (data state unknown), no Retry, and Undo trashes both', async () => {
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return { kind: 'failed', error: 'late' } }),
            item('b', async (p) => { addCharacter(p, 'B'); return { kind: 'failed', error: 'late' } }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(taskHostView()?.failure?.dataState).toBe('unknown')
        expect(actionIds()).toEqual(['undo'])
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(listed('A').trashTime).toBeTypeOf('number')
        expect(listed('B').trashTime).toBeTypeOf('number')
    })

    test('T13 reproducer: Undo clears a selection that points at an imported character', async () => {
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); selectedCharID.set(0); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(get(selectedCharID)).toBe(-1)
    })

    test('T19 reproducer: one slot removed before the press is reported as could not be undone', async () => {
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async (p) => { addCharacter(p, 'B'); return ok }),
            item('c', async (p) => { addCharacter(p, 'C'); return ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        chars().splice(chars().findIndex((c) => c.chaId === 'B'), 1)
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(h.toasts[0].text).toBe('Moved 2 to the Trash, 1 could not be undone')
    })
})

describe('Undo withheld or refused', () => {
    test('T14 guard (a): a backgrounded action offers no Undo', async () => {
        const presenter: TaskToastPresenter = {
            post: (_view, on) => { presenterCalls.posted += 1; presenterCalls.on.push(on); return 7 },
            update: (_id, view) => { presenterCalls.updates.push({ actions: (view.result?.actions ?? []).map((a) => a.id) }) },
            end: () => {},
        }
        setTaskToastPresenter(presenter)
        const done = runImportBatch([item('a', async (p) => {
            addCharacter(p, 'A')
            expect(backgroundTask()).toBe(true)
            return ok
        })], { task: { ...TASK, background: true } })
        for (let i = 0; i < 50 && presenterCalls.updates.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
        expect(presenterCalls.updates.flatMap((u) => u.actions)).not.toContain('undo')
        presenterCalls.on[0].end()
        const summary = await done
        expect(summary.backgrounded).toBe(true)
        expect(listed('A').trashTime).toBeUndefined()
    })

    test('T14 guard (c): an action that imported a preset offers no Undo', async () => {
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('p', async (p) => { p.committed({ kind: 'notUndoable', why: 'preset' }); return ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(actionIds()).toEqual([])
        answerTask({ kind: 'ok' })
        await done
    })

    test('T14 guard (b)/M33: a real Replace offers no Undo, and a programmatic undo answer on that card trashes nothing', async () => {
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('r', async (p) => { p.committed({ kind: 'notUndoable', why: 'replace' }); return ok }),
        ], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        expect(actionIds()).toEqual([])
        answerTask({ kind: 'action', id: 'undo' })
        const summary = await done
        expect(summary.undone).toBeUndefined()
        expect(listed('A').trashTime).toBeUndefined()
        expect(h.toasts).toEqual([])
    })

    test('T14 guard (b): a real module Replace through importModule offers no Undo', async () => {
        install([], [{ id: 'installed', name: 'Same' } as unknown as Mod])
        //One module is added and one replaces the installed duplicate: the action holds both, and the Replace blocks the Undo.
        h.files = [new File([risumBytes({ module: { name: 'Fresh' } })], 'fresh.risum'), new File([risumBytes({ module: { name: 'Same' } })], 'same.risum')]
        h.selectAnswer = '0'
        const done = importModule()
        for (let i = 0; i < 400 && !taskConfirmShowing(); i++) await new Promise((r) => setTimeout(r, 0))
        confirmTask()
        expect(await untilResult(done)).toBe(true)
        expect(DBState.db.modules.map((m) => m.name).sort()).toEqual(['Fresh', 'Same'])
        expect(actionIds()).toEqual([])
        answerTask({ kind: 'ok' })
        await done
    })

    test('T14c guard: a background pressed during the final await of the round withdraws Undo', async () => {
        const presenter: TaskToastPresenter = {
            post: (_view, on) => { presenterCalls.on.push(on); return 7 },
            update: (_id, view) => { presenterCalls.updates.push({ actions: (view.result?.actions ?? []).map((a) => a.id) }) },
            end: () => {},
        }
        setTaskToastPresenter(presenter)
        const { alertStore } = await import('src/ts/stores.svelte')
        const original = alertStore.subscribe.bind(alertStore)
        let pressed = false
        vi.spyOn(alertStore, 'subscribe').mockImplementation((run, invalidate) => {
            if (!pressed) {
                pressed = true
                backgroundTask()
            }
            return original(run, invalidate)
        })
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: { ...TASK, background: true } })
        for (let i = 0; i < 50 && presenterCalls.updates.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
        expect(pressed).toBe(true)
        expect(presenterCalls.updates.flatMap((u) => u.actions)).not.toContain('undo')
        presenterCalls.on[0].end()
        expect((await done).backgrounded).toBe(true)
        expect(listed('A').trashTime).toBeUndefined()
    })

    test('T14d guard: a Replace whose target vanished after the decision becomes an add and offers Undo', async () => {
        install([], [{ id: 'installed', name: 'Same' } as unknown as Mod])
        h.files = [new File([risumBytes({ module: { name: 'Same' } })], 'same.risum')]
        h.selectAnswer = '0'
        //The decision names the installed module; it is removed in the commit's own boot-window mark, before the placement.
        h.onMark = () => { DBState.db.modules.splice(0, 1); h.onMark = null }
        const done = importModule()
        expect(await untilResult(done)).toBe(true)
        expect(DBState.db.modules.map((m) => m.name)).toEqual(['Same'])
        expect(actionIds()).toEqual(['undo'])
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(DBState.db.modules).toEqual([])
    })

    test('T14b guard: round 0 backgrounded, reopened, Retry, round 1 in front: no Undo', async () => {
        const presenter: TaskToastPresenter = {
            post: (_view, on) => { presenterCalls.on.push(on); return 7 },
            update: () => {},
            end: () => {},
        }
        setTaskToastPresenter(presenter)
        let tries = 0
        const done = runImportBatch([
            item('a', async (p) => { addCharacter(p, 'A'); return ok }),
            item('b', async () => {
                tries += 1
                if (tries === 1) {
                    expect(backgroundTask()).toBe(true)
                    return { kind: 'failed', error: 'x' }
                }
                return ok
            }),
        ], { task: { ...TASK, background: true } })
        for (let i = 0; i < 50 && presenterCalls.on.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
        presenterCalls.on[0].open()
        expect(await untilResult(done)).toBe(true)
        expect(actionIds(), 'a reopened card never carries Undo').toEqual(['retry'])
        answerTask({ kind: 'action', id: 'retry' })
        expect(await untilResult(done)).toBe(true)
        expect(actionIds()).toEqual([])
        answerTask({ kind: 'ok' })
        await done
    })

    test('T15/T23 guard: Undo is refused while a restore runs and after the database object was replaced; nothing is written', async () => {
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        const run = beginRestoreRun()
        const keep = listed('A')
        answerTask({ kind: 'action', id: 'undo' })
        await done
        run.end('failed')
        expect(keep.trashTime).toBeUndefined()
        expect(h.toasts).toEqual([{ kind: 'warning', text: language.importUndoRefused }])

        h.toasts = []
        const again = runImportBatch([item('a', async (p) => { addCharacter(p, 'Z'); return ok })], { task: TASK })
        expect(await untilResult(again)).toBe(true)
        const old = listed('Z')
        const oldRoot = DBState.db
        install([], [], [])
        answerTask({ kind: 'action', id: 'undo' })
        await again
        expect(old.trashTime).toBeUndefined()
        expect(oldRoot).not.toBe(DBState.db)
        expect(h.toasts[0].kind).toBe('warning')
    })

    test('T16 guard: the undo makes no inlay cleanup and no asset-deletion call', async () => {
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        h.cleanup.mockClear()
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(listed('A').trashTime).toBeTypeOf('number')
        expect(h.cleanup).not.toHaveBeenCalled()
    })

    test('T24 guard: the boot-window mark is called by the undo', async () => {
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        const before = h.marks
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(h.marks).toBeGreaterThan(before)
    })
})

describe('the card lifetime (MC-2583)', () => {
    test('T28 guard: the card keeps Undo after ten minutes and the press still works', async () => {
        vi.useFakeTimers()
        try {
            const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: TASK })
            await vi.advanceTimersByTimeAsync(0)
            expect(taskResultShowing()).toBe(true)
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
            expect(actionIds()).toEqual(['undo'])
            answerTask({ kind: 'action', id: 'undo' })
            await vi.advanceTimersByTimeAsync(0)
            await done
            expect(listed('A').trashTime).toBeTypeOf('number')
        } finally {
            vi.useRealTimers()
        }
    })

    test('T29 guard: a covering legacy alert does not drop Undo, and the press afterwards trashes A', async () => {
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        const { alertStore } = await import('src/ts/stores.svelte')
        alertStore.set({ type: 'normal', msg: 'hello' })
        alertStore.set({ type: 'none', msg: '' })
        expect(actionIds()).toEqual(['undo'])
        answerTask({ kind: 'action', id: 'undo' })
        await done
        expect(listed('A').trashTime).toBeTypeOf('number')
    })

    test('T30 guard: a newer task replaces the card, nothing is trashed and the summary is not undone', async () => {
        const done = runImportBatch([item('a', async (p) => { addCharacter(p, 'A'); return ok })], { task: TASK })
        expect(await untilResult(done)).toBe(true)
        alertTask({ title: 'Other', steps: [{ label: 'x' }] })
        const summary = await done
        expect(summary.undone).toBeUndefined()
        expect(listed('A').trashTime).toBeUndefined()
        expect(h.toasts).toEqual([])
    })
})
