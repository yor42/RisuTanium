/**
 * The Grid's bulk move to the trash (`trashCharacters`, src/ts/characters.ts) against the real
 * save machinery.
 *
 * REAL and unmocked here: `characters.ts`, `globalApi.svelte.ts` (`checkCharOrder`,
 * `liveCharacterCheck`), `characterSaveMarks.ts`. `hasWorkIn` and `stopWorkIn` are spies so the busy
 * warning is observable. The module-mock set is the one of `characters.trashFolderMembers.svelte.test.ts`.
 * A mocked success here is not evidence of native backend behaviour.
 *
 * Test labels: `(F)` is a feature test (the function is new, so on the earlier base each one fails at
 * the import and proves nothing about a defect); the safety-critical ones are backed by a mutation proof
 * of the function recorded in the stage report.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

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
    const state = { db: {} as unknown as Record<string, unknown> }
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

vi.mock(import('src/ts/process/chatOrigin'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        hasWorkIn: vi.fn(() => false),
        stopWorkIn: vi.fn(),
    }
})

//#endregion
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { liveCharacterCheck, requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { trashCharacters } from 'src/ts/characters'
import type { Database, folder } from 'src/ts/storage/database.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { alertConfirm } from 'src/ts/alert'
import { hasWorkIn, stopWorkIn } from 'src/ts/process/chatOrigin'
import { language } from 'src/lang'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const T0 = 1_700_000_000_000
const T1 = 1_700_000_500_000

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0,
        chats: [{ id: `${chaId}-chat-0-${name}`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

const FOLDER = { id: 'F', name: 'Folder F', color: '', data: ['m1', 'm2', 'm3'] }

/** A folder of three members (m3 already in the trash), two top-level characters, and an untrashed twin of m1. */
function installDb(): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: ['a', { ...FOLDER, data: [...FOLDER.data] }, 'o1', 'o2'],
        characters: [
            makeCharacter('a', 'A'),
            makeCharacter('m1', 'M1'),
            makeCharacter('m2', 'M2'),
            makeCharacter('m3', 'M3', T0),
            makeCharacter('o1', 'O1'),
            makeCharacter('o2', 'O2'),
            makeCharacter('m1', 'M1Twin'),
        ],
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    selectedCharID.set(-1)
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

const folderEntry = (at = 1): folder => DBState.db.characterOrder[at] as folder
const byName = (name: string): CharacterFixture => DBState.db.characters.find((c) => c.name === name)!
const orderNow = (): unknown[] => JSON.parse(JSON.stringify(DBState.db.characterOrder)) as unknown[]
const dbJson = (): string => JSON.stringify(DBState.db)
const selectedNow = (): number => {
    let value = -2
    selectedCharID.subscribe((v) => { value = v })()
    return value
}
const pick = (...names: string[]) => ({ characters: names.map(byName), folders: [] as folder[] })

let tracker: toSaveType

beforeEach(() => {
    installDb()
    // The check also resets the hold a previous test left on `checkCharOrder`.
    liveCharacterCheck()
    requiresFullEncoderReload.state = false
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertConfirm).mockImplementation(async () => true)
    vi.mocked(hasWorkIn).mockReset()
    vi.mocked(hasWorkIn).mockImplementation(() => false)
    vi.mocked(stopWorkIn).mockReset()
    tracker = makeTracker()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('trashCharacters: picked characters', () => {
    test('(F) one confirmation names the count, the picked characters get a trashTime, the others are untouched, each is marked for saving, and the reload flag stays off', async () => {
        const count = await trashCharacters(pick('A', 'O1'))

        expect(count).toBe(2)
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.othersUi.editTrashConfirm(2))
        expect(byName('A').trashTime).toBeGreaterThan(T0)
        expect(byName('O1').trashTime).toBe(byName('A').trashTime)
        expect(byName('O2').trashTime).toBeUndefined()
        expect(byName('M1').trashTime).toBeUndefined()
        expect([...tracker.character].sort()).toEqual(['a', 'o1'])
        expect(requiresFullEncoderReload.state).toBe(false)
        // The check drops the trashed top-level ids, and the member that was already in the trash from the folder.
        expect(orderNow()).toEqual([{ ...FOLDER, data: ['m1', 'm2'] }, 'o2'])
    })

    test('(F) declining writes nothing: the database, the order and the save marks are unchanged', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => false)
        const before = dbJson()
        const order = DBState.db.characterOrder

        expect(await trashCharacters(pick('A', 'O1'))).toBe(0)

        expect(dbJson()).toBe(before)
        expect(DBState.db.characterOrder).toBe(order)
        expect(tracker.character).toEqual([])
        expect(stopWorkIn).not.toHaveBeenCalled()
    })

    test('(F) a busy character adds the working warning and its work is stopped', async () => {
        vi.mocked(hasWorkIn).mockImplementation((target) => target.chaId === 'o1')
        await trashCharacters(pick('A', 'O1'))

        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.othersUi.editTrashConfirm(2) + '\n' + language.removeCharacterWhileWorking)
        expect(stopWorkIn).toHaveBeenCalledWith({ chaId: 'a' })
        expect(stopWorkIn).toHaveBeenCalledWith({ chaId: 'o1' })
    })

    test('(F) a character trashed elsewhere, or removed, while the dialog is open is skipped; its own trashTime and mark stay', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => {
            byName('A').trashTime = T1
            DBState.db.characters.splice(DBState.db.characters.findIndex((c) => c.name === 'O1'), 1)
            return true
        })
        const count = await trashCharacters(pick('A', 'O1', 'O2'))

        expect(count).toBe(1)
        expect(byName('A').trashTime).toBe(T1)
        expect(byName('O2').trashTime).toBeGreaterThan(T1)
        expect(tracker.character).toEqual(['o2'])
        expect(stopWorkIn).toHaveBeenCalledTimes(1)
    })

    test('(F) a picked object that is no longer in the list when asked is not counted, and nothing to trash asks nothing', async () => {
        const gone = byName('O2')
        DBState.db.characters.splice(DBState.db.characters.indexOf(gone), 1)
        const trashed = byName('M3')

        expect(await trashCharacters({ characters: [gone, trashed], folders: [] })).toBe(0)
        expect(await trashCharacters({ characters: [], folders: [] })).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
    })

    test('(F) a hidden system character is never counted or trashed', async () => {
        DBState.db.characters.push(makeCharacter('§temp', 'Temp'))
        const count = await trashCharacters(pick('A', 'Temp'))

        expect(count).toBe(1)
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.othersUi.editTrashConfirm(1))
        expect(byName('Temp').trashTime).toBeUndefined()
    })

    test('(F) the open character is deselected only when it was trashed', async () => {
        selectedCharID.set(DBState.db.characters.findIndex((c) => c.name === 'O2'))
        await trashCharacters(pick('A'))
        expect(selectedNow()).toBe(DBState.db.characters.findIndex((c) => c.name === 'O2'))

        installDb()
        selectedCharID.set(DBState.db.characters.findIndex((c) => c.name === 'A'))
        await trashCharacters(pick('A'))
        expect(selectedNow()).toBe(-1)
    })
})

describe('trashCharacters: the re-check and the emptied folder', () => {
    test('(F) every member of an unpicked folder picked one by one: the emptied folder leaves the order (saving not held)', async () => {
        // No twin: an untrashed second holder of m1 would keep the id, and the folder, alive.
        DBState.db.characters.splice(DBState.db.characters.findIndex((c) => c.name === 'M1Twin'), 1)

        const count = await trashCharacters(pick('M1', 'M2'))

        expect(count).toBe(2)
        expect(orderNow()).toEqual(['a', 'o1', 'o2'])
    })

    test('(F) a picked object removed during the dialog is not trashed, and its visible same-id twin is left alone', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => {
            DBState.db.characters.splice(DBState.db.characters.findIndex((c) => c.name === 'M1'), 1)
            return true
        })
        const detached = byName('M1')
        const count = await trashCharacters({ characters: [detached], folders: [] })

        expect(count).toBe(0)
        expect(detached.trashTime).toBeUndefined()
        expect(byName('M1Twin').trashTime).toBeUndefined()
        expect(stopWorkIn).not.toHaveBeenCalled()
        expect(tracker.character).toEqual([])
    })

    test('(F) a picked character that became hidden during the dialog is not trashed', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => {
            byName('O1').chaId = '§playground'
            return true
        })
        const count = await trashCharacters(pick('O1'))

        expect(count).toBe(0)
        expect(byName('O1').trashTime).toBeUndefined()
        expect(stopWorkIn).not.toHaveBeenCalled()
        expect(tracker.character).toEqual([])
    })
})

describe('trashCharacters: picked folders', () => {
    test('(F) a picked folder trashes its visible untrashed members (a same-id twin included) and leaves the order without the folder; the count names the characters, not the folder', async () => {
        const count = await trashCharacters({ characters: [], folders: [folderEntry()] })

        expect(count).toBe(3)
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.othersUi.editTrashConfirm(3))
        expect(byName('M1').trashTime).toBeGreaterThan(T0)
        expect(byName('M1Twin').trashTime).toBeGreaterThan(T0)
        expect(byName('M2').trashTime).toBeGreaterThan(T0)
        expect(byName('M3').trashTime).toBe(T0)
        expect(orderNow()).toEqual(['a', 'o1', 'o2'])
        expect(requiresFullEncoderReload.state).toBe(false)
    })

    test('(F) a folder and one of its members picked together count and trash that member once', async () => {
        const count = await trashCharacters({ characters: [byName('M1')], folders: [folderEntry()] })

        expect(count).toBe(3)
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.othersUi.editTrashConfirm(3))
        expect(vi.mocked(stopWorkIn).mock.calls.filter(([target]) => target.chaId === 'm1')).toHaveLength(2)
        expect([...new Set(tracker.character)].sort()).toEqual(['m1', 'm2'])
        expect(byName('M1').trashTime).toBe(byName('M2').trashTime)
    })

    test('(F) while saving is held, the picked folder is still replaced by identity (checkCharOrder skips its cleanup then)', async () => {
        // An archived character without a usable id holds saving, through the real check.
        DBState.db.characters.push({ ...makeCharacter('', 'Archived'), chaId: undefined, coldstorage: 'cold' } as unknown as CharacterFixture)
        expect(liveCharacterCheck().held).toHaveLength(1)

        const count = await trashCharacters({ characters: [byName('O1')], folders: [folderEntry()] })

        expect(count).toBe(4)
        expect(byName('O1').trashTime).toBeGreaterThan(0)
        // Only the folder is replaced, by the member that was in the trash before; the trashed
        // top-level id stays until a later check removes it.
        expect(orderNow()).toEqual(['a', 'm3', 'o1', 'o2'])
    })

    test('(F) a folder replaced during the dialog is not edited, though its members are trashed', async () => {
        DBState.db.characters.push(makeCharacter('§temp', 'Temp'))
        vi.mocked(alertConfirm).mockImplementation(async () => {
            DBState.db.characterOrder = ['a', { ...FOLDER, data: ['m1', 'm2', '§temp'] }, 'o1', 'o2']
            return true
        })
        const count = await trashCharacters({ characters: [], folders: [folderEntry()] })

        expect(count).toBe(3)
        expect(orderNow()).toEqual(['a', { ...FOLDER, data: ['§temp'] }, 'o1', 'o2'])
    })

    test('(F) a folder that is the same-id twin of the picked one is left alone', async () => {
        DBState.db.characters.push(makeCharacter('§temp', 'Temp'))
        const twin = { ...FOLDER, data: ['o1', '§temp'] }
        DBState.db.characterOrder.splice(1, 0, twin)
        const count = await trashCharacters({ characters: [], folders: [folderEntry(2)] })

        expect(count).toBe(3)
        expect(orderNow()).toEqual(['a', { ...FOLDER, data: ['o1', '§temp'] }, 'o1', 'o2'])
    })

    test('(F) a folder with nothing to trash asks nothing and is not edited', async () => {
        const before = orderNow()
        expect(await trashCharacters({ characters: [], folders: [{ ...FOLDER, data: ['m3'] }] })).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(orderNow()).toEqual(before)
    })
})
