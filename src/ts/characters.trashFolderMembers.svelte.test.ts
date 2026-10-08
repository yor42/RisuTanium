/**
 * "Delete folder, move to trash" (`trashFolderMembers`, src/ts/characters.ts) against the real
 * save machinery.
 *
 * REAL and unmocked here: `characters.ts`, `globalApi.svelte.ts` (`checkCharOrder`,
 * `liveCharacterCheck`, `prepareSaveIteration`), `characterSaveMarks.ts` and `risuSave.ts`. The
 * module-mock set is the one of `characters.removeTrashedCharacters.save.svelte.test.ts`. A mocked
 * success here is not evidence of native backend behaviour.
 *
 * Test labels: `(U)` states the rule; `(G)` is proven by a mutant of the function it fails
 * against, not by failing before the change.
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
import { liveCharacterCheck, prepareSaveIteration, requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { trashFolderMembers, untrashedMembersOf } from 'src/ts/characters'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { Database, folder } from 'src/ts/storage/database.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { alertConfirm } from 'src/ts/alert'
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

/** A folder of three members (m3 already in the trash), a top-level character, and an untrashed twin of m1. */
function installDb(): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: ['a', { ...FOLDER, data: [...FOLDER.data] }, 'o1'],
        characters: [
            makeCharacter('a', 'A'),
            makeCharacter('m1', 'M1'),
            makeCharacter('m2', 'M2'),
            makeCharacter('m3', 'M3', T0),
            makeCharacter('o1', 'O1'),
            makeCharacter('m1', 'M1Twin'),
        ],
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    selectedCharID.set(-1)
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

/** The folder as the rail reads it: the object `DBState.db.characterOrder` holds. */
const folderEntry = (at = 1): folder => DBState.db.characterOrder[at] as folder
const snapshot = () => $state.snapshot(DBState.db) as Database
const byName = (name: string): CharacterFixture => DBState.db.characters.find((c) => c.name === name)!
const orderNow = (): unknown[] => $state.snapshot(DBState.db.characterOrder) as unknown[]

let tracker: toSaveType

beforeEach(() => {
    installDb()
    // The check also resets the hold a previous test left on `checkCharOrder`.
    liveCharacterCheck()
    requiresFullEncoderReload.state = false
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertConfirm).mockImplementation(async () => true)
    tracker = makeTracker()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('trashFolderMembers', () => {
    test('(R) the untrashed members, a same-id twin included, are trashed; the others and the already-trashed one are untouched; the folder is gone', async () => {
        const count = await trashFolderMembers(folderEntry(), FOLDER.name)

        expect(count).toBe(3)
        expect(byName('M1').trashTime).toBeGreaterThan(0)
        expect(byName('M1Twin').trashTime).toBeGreaterThan(0)
        expect(byName('M2').trashTime).toBeGreaterThan(0)
        expect(byName('M3').trashTime).toBe(T0)
        expect(byName('A').trashTime).toBeUndefined()
        expect(byName('O1').trashTime).toBeUndefined()
        expect(orderNow()).toEqual(['a', 'o1'])
    })

    test('(U) one confirmation names the folder and the count of untrashed members, and a refusal changes nothing', async () => {
        await trashFolderMembers(folderEntry(), FOLDER.name)
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        const text = String(vi.mocked(alertConfirm).mock.calls[0][0])
        expect(text).toContain('Folder F')
        expect(text).toBe(language.deleteFolderTrashConfirm('Folder F', 3))

        installDb()
        tracker.character.length = 0
        vi.mocked(alertConfirm).mockImplementation(async () => false)
        expect(await trashFolderMembers(folderEntry(), FOLDER.name)).toBe(0)
        expect(DBState.db.characters.filter((c) => c.trashTime).map((c) => c.name)).toEqual(['M3'])
        expect(tracker.character).toEqual([])
    })

    test('(U) nothing to trash asks nothing', async () => {
        expect(await trashFolderMembers({ ...FOLDER, data: ['m3'] }, 'Folder F')).toBe(0)
        expect(await trashFolderMembers({ ...FOLDER, data: [] }, 'Folder F')).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(untrashedMembersOf(['m3'])).toEqual([])
    })

    test('(U) the selection is cleared only when a trashed member was selected', async () => {
        selectedCharID.set(DBState.db.characters.findIndex((c) => c.name === 'A'))
        await trashFolderMembers(folderEntry(), FOLDER.name)
        let selected = -2
        selectedCharID.subscribe((v) => { selected = v })()
        expect(selected).toBe(DBState.db.characters.findIndex((c) => c.name === 'A'))

        installDb()
        selectedCharID.set(DBState.db.characters.findIndex((c) => c.name === 'M2'))
        await trashFolderMembers(folderEntry(), FOLDER.name)
        selectedCharID.subscribe((v) => { selected = v })()
        expect(selected).toBe(-1)
    })

    test('(G) a member trashed elsewhere while the dialog is open keeps its trashTime, and one removed meanwhile gets no mark', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => {
            byName('M1').trashTime = T1
            const at = DBState.db.characters.findIndex((c) => c.name === 'M2')
            DBState.db.characters.splice(at, 1)
            return true
        })
        const count = await trashFolderMembers(folderEntry(), FOLDER.name)

        expect(byName('M1').trashTime).toBe(T1)
        expect(byName('M1Twin').trashTime).toBeGreaterThan(T1)
        expect(DBState.db.characters.some((c) => c.name === 'M2')).toBe(false)
        expect(count).toBe(1)
        expect(tracker.character).toEqual(['m1'])
    })
})

describe('the save after trashing', () => {
    test('(G) a non-selected member\'s trashTime persists through a save round trip, because each member is marked', async () => {
        // Two characters sharing a chaId share one saved block, so the round trip uses no twin.
        DBState.db.characters.splice(DBState.db.characters.findIndex((c) => c.name === 'M1Twin'), 1)
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshot(), { compression: false })

        await trashFolderMembers(folderEntry(), FOLDER.name)
        expect(requiresFullEncoderReload.state).toBe(false)
        expect([...tracker.character].sort()).toEqual(['m1', 'm2'])

        const iteration = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag: requiresFullEncoderReload,
            reinitEncoder: async () => {
                const fresh = new RisuSaveEncoder()
                await fresh.init(snapshot(), { compression: false })
                return fresh
            },
            getDatabase: () => snapshot(),
        })
        await iteration.encoder.set(snapshot(), iteration.toSave)
        const decoded = await decodeRisuSave(new Uint8Array(iteration.encoder.encode()!))
        const trashed = (decoded.characters ?? []).filter((c: CharacterFixture) => c.trashTime).map((c: CharacterFixture) => c.chaId).sort()
        expect(trashed).toEqual(['m1', 'm2', 'm3'])
    })

    test('(G) while saving is held, the members are trashed and leave the order with the folder, and the count excludes the already-trashed one', async () => {
        // An archived character without a usable id holds saving, through the real check.
        DBState.db.characters.push({ ...makeCharacter('', 'Archived'), chaId: undefined, coldstorage: 'cold' } as unknown as CharacterFixture)
        expect(liveCharacterCheck().held).toHaveLength(1)

        const count = await trashFolderMembers(folderEntry(), FOLDER.name)

        expect(count).toBe(3)
        expect(byName('M1').trashTime).toBeGreaterThan(0)
        expect(byName('M2').trashTime).toBeGreaterThan(0)
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toContain(language.deleteFolderTrashConfirm('Folder F', 3))
        // Only the checkCharOrder cleanup is skipped while held: the folder is replaced by the
        // ids not just trashed, here the member that was in the trash before.
        expect(orderNow()).toEqual(['a', 'm3', 'o1'])
    })

    test('(G) while saving is held, an id with no character in the list (a held save) stays where the folder was', async () => {
        DBState.db.characters.push({ ...makeCharacter('', 'Archived'), chaId: undefined, coldstorage: 'cold' } as unknown as CharacterFixture)
        folderEntry().data.push('saved-id')
        expect(liveCharacterCheck().held).toHaveLength(1)

        await trashFolderMembers(folderEntry(), FOLDER.name)

        expect(orderNow()).toEqual(['a', 'm3', 'saved-id', 'o1'])
    })
})

describe('trashFolderMembers and hidden characters', () => {
    beforeEach(() => {
        DBState.db.characters.push(makeCharacter('§temp', 'Temp'), makeCharacter('§playground', 'Playground'))
        folderEntry().data.splice(1, 0, '§temp')
        folderEntry().data.push('§playground')
    })

    test('(R) hidden members are neither counted nor trashed, and they take the folder\'s place in the order', async () => {
        const count = await trashFolderMembers(folderEntry(), FOLDER.name)

        expect(count).toBe(3)
        expect(String(vi.mocked(alertConfirm).mock.calls[0][0])).toBe(language.deleteFolderTrashConfirm('Folder F', 3))
        expect(byName('Temp').trashTime).toBeUndefined()
        expect(byName('Playground').trashTime).toBeUndefined()
        expect(orderNow()).toEqual(['a', '§temp', '§playground', 'o1'])
    })

    test('(R) a folder of only hidden members trashes nothing and asks nothing', async () => {
        const hiddenOnly = { ...FOLDER, data: ['§temp', '§playground'] }
        expect(await trashFolderMembers(hiddenOnly, FOLDER.name)).toBe(0)
        expect(alertConfirm).not.toHaveBeenCalled()
    })

    test('(G) a refusal leaves the order alone', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => false)
        const before = orderNow()
        expect(await trashFolderMembers(folderEntry(), FOLDER.name)).toBe(0)
        expect(orderNow()).toEqual(before)
    })

    test('(G) a same-id twin folder is left alone: the entry that was passed is the one replaced', async () => {
        const twin = { ...FOLDER, data: ['o1', '§temp'] }
        DBState.db.characterOrder.splice(1, 0, twin)
        const count = await trashFolderMembers(folderEntry(2), FOLDER.name)

        expect(count).toBe(3)
        expect(orderNow()).toEqual(['a', { ...FOLDER, data: ['o1', '§temp'] }, '§temp', '§playground', 'o1'])
    })

    test('(G) a folder replaced during the dialog is not edited, though its members are trashed', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => {
            DBState.db.characterOrder = ['a', { ...FOLDER, data: ['m1', 'm2', '§temp'] }, 'o1']
            return true
        })
        const count = await trashFolderMembers(folderEntry(), FOLDER.name)

        expect(count).toBe(3)
        expect(orderNow()).toEqual(['a', { ...FOLDER, data: ['§temp'] }, 'o1'])
    })
})
