/**
 * The trash functions report what one action trashed through an optional `onTrashed` callback
 * (`TrashedBatch`: the shared `trashTime` and the trashed chaIds in order position), so the library can offer an Undo.
 *
 * REAL and unmocked here: `characters.ts`, `globalApi.svelte.ts` (`checkCharOrder`), the save marks, and a real
 * `$state` database. The module-mock set is the one of `characters.trashOrigin.svelte.test.ts`.
 *
 * Titles: "reproducer" fails on the code before the change for the named assertion; "guard" passes before and after.
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

vi.mock(import('src/ts/caughtErrors'), async (importOriginal) => ({
    ...(await importOriginal()),
    recordCaughtError: vi.fn(),
}))

//#endregion
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { liveCharacterCheck, requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { removeChar, trashCharacters, trashFolderMembers, type TrashedBatch } from 'src/ts/characters'
import { alertConfirm } from 'src/ts/alert'
import { recordCaughtError } from 'src/ts/caughtErrors'
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

let tracker: toSaveType

beforeEach(() => {
    requiresFullEncoderReload.state = false
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertConfirm).mockResolvedValue(true)
    vi.mocked(recordCaughtError).mockClear()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('removeChar reports the character it trashed', () => {
    test('reproducer T1: one trashed slot is reported once with its trashTime and chaId', async () => {
        install(['a', 'C'], [mk('a'), mk('C')])
        const onTrashed = vi.fn()

        await removeChar(listed('C'), 'C', 'normal', { onTrashed })

        expect(onTrashed).toHaveBeenCalledTimes(1)
        expect(onTrashed).toHaveBeenCalledWith({ at: listed('C').trashTime, chaIds: ['C'] })
    })

    test('guard T1n: nothing is reported for a declined first confirm, a declined second confirm, a permanent delete or a slot that was already trashed', async () => {
        install(['a', 'C'], [mk('a'), mk('C'), mk('T', 5)])
        const onTrashed = vi.fn()

        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        await removeChar(listed('C'), 'C', 'normal', { onTrashed })
        vi.mocked(alertConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
        await removeChar(listed('C'), 'C', 'normal', { onTrashed })
        expect(listed('C').trashTime).toBeUndefined()

        await removeChar(listed('T'), 'T', 'normal', { onTrashed })
        expect(onTrashed).not.toHaveBeenCalled()

        await removeChar(listed('C'), 'C', 'permanentForce', { onTrashed })
        expect(DBState.db.characters.some((c) => c.chaId === 'C')).toBe(false)
        expect(onTrashed).not.toHaveBeenCalled()
    })

    test('reproducer T5r: a throwing callback leaves the trash complete, resolves, and the error is recorded', async () => {
        install(['a', 'C'], [mk('a'), mk('C')])
        const onTrashed = vi.fn(() => { throw new Error('toast failed') })

        await expect(removeChar(listed('C'), 'C', 'normal', { onTrashed })).resolves.toBeUndefined()

        expect(onTrashed).toHaveBeenCalledTimes(1)
        expect(listed('C').trashTime).toBeTypeOf('number')
        expect(tracker.character).toContain('C')
        expect(recordCaughtError).toHaveBeenCalledWith('characters.onTrashed', expect.any(Error))
    })
})

describe('trashCharacters reports the batch in order position', () => {
    test('reproducer T2: picks in reverse order are reported in the order the library lists them', async () => {
        install([F('F', 'A', 'B', 'X')], [mk('A'), mk('B'), mk('X')])
        const onTrashed = vi.fn()

        const count = await trashCharacters({ characters: [listed('B'), listed('A')], folders: [] }, { onTrashed })

        expect(count).toBe(2)
        expect(onTrashed).toHaveBeenCalledTimes(1)
        const batch: TrashedBatch = onTrashed.mock.calls[0][0]
        expect(batch.chaIds).toEqual(['A', 'B'])
        expect(batch.at).toBe(listed('A').trashTime)
        expect(batch.at).toBe(listed('B').trashTime)
    })

    test('reproducer T2t: same-id twins appear once each', async () => {
        const twin = mk('A')
        install(['A', 'Z'], [mk('A'), twin, mk('Z')])
        const onTrashed = vi.fn()

        await trashCharacters({ characters: [DBState.db.characters[0], DBState.db.characters[1]], folders: [] }, { onTrashed })

        expect(onTrashed).toHaveBeenCalledTimes(1)
        expect(onTrashed.mock.calls[0][0].chaIds).toEqual(['A', 'A'])
    })

    test('reproducer T3b: members of a picked folder are reported in the folder\'s member order, not the list order', async () => {
        install(['P', F('F', 'm1', 'm2', 'm3')], [mk('P'), mk('m3'), mk('m1'), mk('m2')])
        const onTrashed = vi.fn()

        await trashCharacters({ characters: [], folders: [folderAt(1)] }, { onTrashed })

        expect(onTrashed).toHaveBeenCalledTimes(1)
        expect(onTrashed.mock.calls[0][0].chaIds).toEqual(['m1', 'm2', 'm3'])
    })

    test('reproducer T4: the callback runs after the order repair, the marks and the selection change', async () => {
        install(['P', 'C', 'D'], [mk('P'), mk('C'), mk('D')])
        selectedCharID.set(1)
        const seen: { order: unknown, marked: string[], selected: number }[] = []
        const onTrashed = vi.fn(() => {
            seen.push({
                order: $state.snapshot(DBState.db.characterOrder),
                marked: [...tracker.character],
                selected: get(selectedCharID),
            })
        })

        await trashCharacters({ characters: [listed('C'), listed('D')], folders: [] }, { onTrashed })

        expect(seen).toEqual([{ order: ['P'], marked: ['C', 'D'], selected: -1 }])
    })

    test('guard T3n: nothing is reported for a declined confirm or when nothing is trashable', async () => {
        install(['A'], [mk('A'), mk('T', 5)])
        const onTrashed = vi.fn()

        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        await trashCharacters({ characters: [listed('A')], folders: [] }, { onTrashed })
        await trashCharacters({ characters: [listed('T')], folders: [] }, { onTrashed })

        expect(onTrashed).not.toHaveBeenCalled()
        expect(listed('A').trashTime).toBeUndefined()
    })

    test('reproducer T5: a throwing callback leaves every slot trashed and marked, and the count returned', async () => {
        install(['A', 'B'], [mk('A'), mk('B')])
        const onTrashed = vi.fn(() => { throw new Error('toast failed') })

        const count = await trashCharacters({ characters: [listed('A'), listed('B')], folders: [] }, { onTrashed })

        expect(onTrashed).toHaveBeenCalledTimes(1)
        expect(count).toBe(2)
        expect(listed('A').trashTime).toBeTypeOf('number')
        expect(listed('B').trashTime).toBeTypeOf('number')
        expect(tracker.character).toEqual(expect.arrayContaining(['A', 'B']))
        expect(recordCaughtError).toHaveBeenCalledWith('characters.onTrashed', expect.any(Error))
    })
})

describe('trashFolderMembers reports the batch in the folder\'s member order', () => {
    test('reproducer T3: the list order differs from the member order', async () => {
        install(['P', F('F', 'm1', 'm2', 'm3')], [mk('P'), mk('m3'), mk('m1'), mk('m2')])
        const onTrashed = vi.fn()

        const count = await trashFolderMembers(folderAt(1), 'F', { onTrashed })

        expect(count).toBe(3)
        expect(onTrashed).toHaveBeenCalledTimes(1)
        const batch: TrashedBatch = onTrashed.mock.calls[0][0]
        expect(batch.chaIds).toEqual(['m1', 'm2', 'm3'])
        expect(batch.at).toBe(listed('m1').trashTime)
    })

    test('guard T3m: nothing is reported when declined or when the folder has no trashable member', async () => {
        install(['P', F('F', 'm1'), F('E', 't')], [mk('P'), mk('m1'), mk('t', 5)])
        const onTrashed = vi.fn()

        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        await trashFolderMembers(folderAt(1), 'F', { onTrashed })
        await trashFolderMembers(folderAt(2), 'E', { onTrashed })

        expect(onTrashed).not.toHaveBeenCalled()
    })
})
