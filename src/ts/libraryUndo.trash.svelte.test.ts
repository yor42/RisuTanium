/**
 * The Undo of a move to the trash (`src/ts/libraryUndo.ts`): it finds each trashed slot by chaId plus the batch's
 * `trashTime` in the live list and restores it through `restoreCharacterFromTrash`, so placement, the save mark and
 * the origin release are the trash list's own.
 *
 * REAL and unmocked here: `characters.ts`, `globalApi.svelte.ts` (`checkCharOrder`), `trashOrigin.ts`, the save
 * marks with a real tracker, the toast host, and a real `$state` database. The module-mock set is the one of
 * `characters.trashOrigin.svelte.test.ts`. Trash state always comes from the real trash functions.
 *
 * Titles: "rule" pins behaviour of the new module and so cannot run before the change (the import is missing);
 * "guard" passes before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'


//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
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
    open: vi.fn(async () => {}),
}))

vi.mock('streamsaver', () => ({
    default: {},
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    parseMarkdownSafe: vi.fn(),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    importCharacter: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => {})
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

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

//#endregion
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { liveCharacterCheck, requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { removeChar, removeTrashedCharacters, restoreCharacterFromTrash, trashCharacters, trashFolderMembers, type TrashedBatch } from 'src/ts/characters'
import { postTrashUndo, trashUndoAction } from 'src/ts/libraryUndo'
import { resetToastHostForTests, toastHost } from 'src/ts/toast/toastHost.svelte'
import { language } from 'src/lang'
import type { Database, folder } from 'src/ts/storage/database.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'

//#region fixtures

type Ch = Database['characters'][number]
type OrderEntry = string | folder

const mk = (chaId: string, trashTime?: number): Ch => ({
    chaId, name: chaId, type: 'character', chatPage: 0,
    chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    trashTime,
}) as unknown as Ch

const F = (id: string, ...data: string[]): folder => ({ id, name: id, color: '', data })

function install(order: OrderEntry[], chars: Ch[]): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], enabledModules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: order, characters: chars,
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    selectedCharID.set(-1)
    liveCharacterCheck()
}

/** The reactive entry: the trash functions resolve a character object by reference. */
const listed = (chaId: string): Ch => DBState.db.characters.find((c) => c.chaId === chaId)!
const folderAt = (at: number): folder => DBState.db.characterOrder[at] as folder
const orderNow = (): OrderEntry[] => $state.snapshot(DBState.db.characterOrder) as OrderEntry[]
const dbNow = (): unknown => $state.snapshot(DBState.db)
const originsNow = (): unknown => $state.snapshot(DBState.db.trashOrigins ?? [])

let tracker: toSaveType
let schedule: ReturnType<typeof vi.fn<() => void>>
let batches: TrashedBatch[]
const collect = { onTrashed: (batch: TrashedBatch) => { batches.push(batch) } }

beforeEach(() => {
    requiresFullEncoderReload.state = false
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    schedule = vi.fn<() => void>()
    installCharacterSaveMarks({ tracker, schedule })
    resetToastHostForTests()
    batches = []
})

afterEach(() => {
    vi.useRealTimers()
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('undo of a trash puts characters back through the trash list\'s restore', () => {
    test('rule U1: a folder member comes back after its anchor, its record is released, and the text counts one', async () => {
        install([F('f', 'P', 'C', 'Q'), 'y'], [mk('P'), mk('C'), mk('Q'), mk('y')])
        await removeChar(listed('C'), 'C', 'normal', collect)
        expect(orderNow()).toEqual([F('f', 'P', 'Q'), 'y'])

        const outcome = trashUndoAction(batches[0]).run()

        expect(outcome).toEqual({ ok: true, text: language.othersUi.libraryUndoRestored(1) })
        expect(listed('C').trashTime).toBeUndefined()
        expect(orderNow()).toEqual([F('f', 'P', 'C', 'Q'), 'y'])
        expect(originsNow()).toEqual([])
    })

    test('rule U2: members trashed together come back in their original member order whatever the pick order', async () => {
        install([F('f', 'A', 'B', 'C', 'X')], [mk('A'), mk('B'), mk('C'), mk('X')])
        await trashCharacters({ characters: [listed('C'), listed('B'), listed('A')], folders: [] }, collect)
        expect(orderNow()).toEqual([F('f', 'X')])

        const outcome = trashUndoAction(batches[0]).run()

        expect(outcome).toEqual({ ok: true, text: language.othersUi.libraryUndoRestored(3) })
        expect(orderNow()).toEqual([F('f', 'A', 'B', 'C', 'X')])
    })

    test('rule U3: members of a deleted, dissolved or emptied folder come back at the top-level end in the folder\'s member order, with the end note', async () => {
        // The list order differs from the member order, so only the batch's order position keeps the members in order.
        const cases: { name: string, trash: () => Promise<unknown> }[] = [
            { name: 'delete folder and trash its members', trash: () => trashFolderMembers(folderAt(1), 'F', collect) },
            { name: 'bulk trash with the folder picked', trash: () => trashCharacters({ characters: [], folders: [folderAt(1)] }, collect) },
        ]
        for (const { name, trash } of cases) {
            batches = []
            resetToastHostForTests()
            install(['P', F('F', 'm1', 'm2', 'm3')], [mk('P'), mk('m3'), mk('m1'), mk('m2')])
            await trash()
            postTrashUndo(batches[0])
            expect(toastHost.visible[0].sub, name).toBe(language.othersUi.libraryUndoTrashedEndNote)

            const outcome = trashUndoAction(batches[0]).run()

            expect(outcome, name).toEqual({ ok: true, text: language.othersUi.libraryUndoRestored(3) })
            expect(orderNow(), name).toEqual(['P', 'm1', 'm2', 'm3'])
        }

        batches = []
        resetToastHostForTests()
        install(['P', F('F', 'C')], [mk('P'), mk('C')])
        await removeChar(listed('C'), 'C', 'normal', collect)
        expect(orderNow()).toEqual(['P'])
        postTrashUndo(batches[0])
        expect(toastHost.visible[0].sub).toBe(language.othersUi.libraryUndoTrashedEndNote)
        trashUndoAction(batches[0]).run()
        expect(orderNow()).toEqual(['P', 'C'])
    })

    test('rule U3n: a character that returns after a top-level anchor gets no end note', async () => {
        install(['P', 'C', 'Q'], [mk('P'), mk('C'), mk('Q')])
        await removeChar(listed('C'), 'C', 'normal', collect)

        postTrashUndo(batches[0])

        expect(toastHost.visible.length).toBe(1)
        expect(toastHost.visible[0].text).toBe(language.othersUi.libraryUndoTrashed(1))
        expect(toastHost.visible[0].sub).toBeUndefined()
    })
})

describe('undo refuses what is no longer the trashing it was made for', () => {
    test('rule U4a: after a restore by hand it refuses and changes nothing', async () => {
        install(['P', 'C'], [mk('P'), mk('C')])
        await removeChar(listed('C'), 'C', 'normal', collect)
        restoreCharacterFromTrash(listed('C'))
        const before = dbNow()

        const outcome = trashUndoAction(batches[0]).run()

        expect(outcome).toEqual({ ok: false, text: language.othersUi.libraryUndoTrashRefused })
        expect(dbNow()).toEqual(before)
    })

    test('rule U4b: after a restore and a later re-trash it refuses and the character stays trashed', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(1_000_000)
        install(['P', 'C'], [mk('P'), mk('C')])
        await removeChar(listed('C'), 'C', 'normal', collect)
        restoreCharacterFromTrash(listed('C'))
        vi.setSystemTime(2_000_000)
        await removeChar(listed('C'), 'C')
        const before = dbNow()

        const outcome = trashUndoAction(batches[0]).run()

        expect(outcome).toEqual({ ok: false, text: language.othersUi.libraryUndoTrashRefused })
        expect(listed('C').trashTime).toBe(2_000_000)
        expect(dbNow()).toEqual(before)
    })

    test('rule U4c: after a permanent delete it refuses and changes nothing', async () => {
        install(['P', 'C'], [mk('P'), mk('C')])
        await removeChar(listed('C'), 'C', 'normal', collect)
        await removeChar(listed('C'), 'C', 'permanentForce')
        const before = dbNow()

        const outcome = trashUndoAction(batches[0]).run()

        expect(outcome).toEqual({ ok: false, text: language.othersUi.libraryUndoTrashRefused })
        expect(dbNow()).toEqual(before)
    })

    test('rule U4d: when only part of the batch still matches, the rest comes back and the text says how many', async () => {
        install([F('f', 'A', 'B', 'X')], [mk('A'), mk('B'), mk('X')])
        await trashCharacters({ characters: [listed('A'), listed('B')], folders: [] }, collect)
        restoreCharacterFromTrash(listed('A'))

        const outcome = trashUndoAction(batches[0]).run()

        expect(outcome).toEqual({ ok: true, text: language.othersUi.libraryUndoRestored(1) })
        expect(listed('A').trashTime).toBeUndefined()
        expect(listed('B').trashTime).toBeUndefined()
        expect(orderNow()).toEqual([F('f', 'A', 'B', 'X')])
    })

    test('rule U4e: a second run of the same undo refuses', async () => {
        install(['P', 'C'], [mk('P'), mk('C')])
        await removeChar(listed('C'), 'C', 'normal', collect)
        const action = trashUndoAction(batches[0])

        expect(action.run()).toEqual({ ok: true, text: language.othersUi.libraryUndoRestored(1) })
        expect(action.run()).toEqual({ ok: false, text: language.othersUi.libraryUndoTrashRefused })
    })
})

describe('undo resolves the live slot, not a held reference', () => {
    test('rule U5: a slot swapped in for the trashed one (same id, copied trashTime, same index) is the one restored', async () => {
        install(['P', 'C'], [mk('P'), mk('C')])
        await removeChar(listed('C'), 'C', 'normal', collect)
        const undo = trashUndoAction(batches[0])
        const at = DBState.db.characters.findIndex((c) => c.chaId === 'C')
        const original = DBState.db.characters[at]
        DBState.db.characters[at] = { ...($state.snapshot(original) as Ch) }

        const outcome = undo.run()

        expect(outcome).toEqual({ ok: true, text: language.othersUi.libraryUndoRestored(1) })
        expect(DBState.db.characters[at].trashTime).toBeUndefined()
        expect(original.trashTime).toBeTypeOf('number')
        expect(orderNow()).toEqual(['P', 'C'])
    })
})

describe('undo reaches the save', () => {
    test('rule U6: every restored character is marked and a save is scheduled, through the real marks', async () => {
        install(['P', 'A', 'B'], [mk('P'), mk('A'), mk('B')])
        await trashCharacters({ characters: [listed('A'), listed('B')], folders: [] }, collect)
        tracker.character.length = 0
        schedule.mockClear()

        trashUndoAction(batches[0]).run()

        expect(tracker.character).toEqual(expect.arrayContaining(['A', 'B']))
        expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
})

describe('what undo does not restore', () => {
    test('guard U7: the selection stays cleared and the encoder reload flag stays set', async () => {
        install(['P', 'C'], [mk('P'), mk('C')])
        selectedCharID.set(1)
        await removeChar(listed('C'), 'C', 'normal', collect)
        expect(get(selectedCharID)).toBe(-1)
        expect(requiresFullEncoderReload.state).toBe(true)

        trashUndoAction(batches[0]).run()

        expect(get(selectedCharID)).toBe(-1)
        expect(requiresFullEncoderReload.state).toBe(true)
    })
})

describe('the toast', () => {
    test('rule U8: one undo toast is posted, Undo restores and shows the success text, and the toast ends after 6 s', async () => {
        vi.useFakeTimers()
        install(['P', 'C'], [mk('P'), mk('C')])
        await removeChar(listed('C'), 'C', 'normal', { onTrashed: postTrashUndo })

        expect(toastHost.visible.length).toBe(1)
        expect(toastHost.visible[0].kind).toBe('undo')
        expect(toastHost.visible[0].text).toBe(language.othersUi.libraryUndoTrashed(1))
        expect(toastHost.visible[0].actionLabel).toBe(language.uiCommon.undo)

        await toastHost.activate(toastHost.visible[0].id)

        expect(listed('C').trashTime).toBeUndefined()
        expect(toastHost.visible[0].kind).toBe('success')
        expect(toastHost.visible[0].text).toBe(language.othersUi.libraryUndoRestored(1))

        await removeChar(listed('P'), 'P', 'normal', { onTrashed: postTrashUndo })
        const trashToasts = toastHost.visible.filter((t) => t.kind === 'undo')
        expect(trashToasts.length).toBe(1)
        vi.advanceTimersByTime(6000)
        expect(toastHost.visible.filter((t) => t.kind === 'undo').length).toBe(0)
    })

    test('guard U9: nothing is posted for Empty trash or a permanent delete', async () => {
        install(['P'], [mk('P'), mk('T', 5), mk('U', 6)])

        await removeTrashedCharacters([listed('T')], { matching: false })
        await removeChar(listed('U'), 'U', 'permanentForce')

        expect(toastHost.visible.length).toBe(0)
    })
})
