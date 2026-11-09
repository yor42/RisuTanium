/**
 * Restoring a character from the trash puts it back where it was (`trashOrigins`, src/ts/trashOrigin.ts).
 *
 * REAL and unmocked here: `characters.ts` (`removeChar`, `trashCharacters`, `restoreCharacterFromTrash`),
 * `globalApi.svelte.ts` (`checkCharOrder`, `liveCharacterCheck`), the save marks, and a real `$state` database. The
 * module-mock set is the one of `characters.trashFolderMembers.svelte.test.ts`. A mocked success here is not
 * evidence of native backend behaviour.
 *
 * Titles: "reproducer" fails on the code before the change for the named assertion; "guard" passes before and after
 * (it pins a rule the change must not break, or a rule the old code met by always restoring to the end); "rule" pins
 * new record handling and so cannot pass before the change.
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
import { liveCharacterCheck, requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { removeChar, restoreCharacterFromTrash, trashCharacters } from 'src/ts/characters'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { stubFromEntry } from 'src/ts/storage/store2/codec/stub'
import type { ShardEntry } from 'src/ts/storage/store2/format'
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

function install(order: OrderEntry[], chars: Ch[], extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], enabledModules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: order, characters: chars, ...extra,
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    selectedCharID.set(-1)
    // The check also resets the hold a previous test left on `checkCharOrder`.
    liveCharacterCheck()
}

/** The reactive entry: `removeChar` and the restore resolve a character object by reference. */
const listed = (chaId: string): Ch => DBState.db.characters.find((c) => c.chaId === chaId)!
const orderNow = (): OrderEntry[] => $state.snapshot(DBState.db.characterOrder) as OrderEntry[]
const originsNow = (): unknown => $state.snapshot(DBState.db.trashOrigins)

let tracker: toSaveType

beforeEach(() => {
    requiresFullEncoderReload.state = false
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: () => {} })
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('restore goes back to the previous folder and position', () => {
    test('reproducer T1: a picked folder member trashed with trashCharacters returns after its anchor in the folder', async () => {
        install(['x', F('f1', 'a', 'C', 'b')], [mk('x'), mk('a'), mk('C'), mk('b')])

        await trashCharacters({ characters: [listed('C')], folders: [] })
        expect(orderNow()).toEqual(['x', F('f1', 'a', 'b')])
        const recorded = originsNow()

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', F('f1', 'a', 'C', 'b')])
        expect(recorded).toEqual([{ chaId: 'C', t: expect.any(Number), folder: 'f1', after: { char: 'a' } }])
        expect(listed('C').trashTime).toBeUndefined()
        expect(tracker.character).toContain('C')
    })

    test('reproducer T2: a top-level character trashed with removeChar returns after its top-level anchor', async () => {
        install(['x', 'C', 'y'], [mk('x'), mk('C'), mk('y')])

        await removeChar(listed('C'), 'C')
        expect(orderNow()).toEqual(['x', 'y'])

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'C', 'y'])
    })

    test('guard T3: the folder was removed meanwhile, so the character goes to the top-level end', async () => {
        install(['x', F('f1', 'a', 'C')], [mk('x'), mk('a'), mk('C')])
        await trashCharacters({ characters: [listed('C')], folders: [] })
        // The person deleted the folder: it is replaced by its members.
        ;(DBState.db.characterOrder as OrderEntry[]).splice(1, 1, 'a')

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'a', 'C'])
    })

    test('guard T3b: a folder of the same name but another id is never entered', async () => {
        // The captured folder's name is unique when C is trashed and differs from its id, so only an id lookup
        // can tell it from the look-alike that takes its name afterwards.
        install(['x', { ...F('f1', 'a', 'C'), name: 'Shelf' }, 'b'], [mk('x'), mk('a'), mk('C'), mk('b')])
        await trashCharacters({ characters: [listed('C')], folders: [] })
        expect(originsNow()).toEqual([{ chaId: 'C', t: expect.any(Number), folder: 'f1', after: { char: 'a' } }])
        // The person deleted the folder (replaced by its members) and moved b into another one with the same name.
        ;(DBState.db.characterOrder as OrderEntry[]).splice(1, 2, 'a', { ...F('g2', 'b'), name: 'Shelf' })

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'a', { ...F('g2', 'b'), name: 'Shelf' }, 'C'])
    })

    test('guard T3c: a folder the trash itself emptied stays gone and its only member returns to the top-level end', async () => {
        install(['x', F('f1', 'C')], [mk('x'), mk('C')])
        await trashCharacters({ characters: [listed('C')], folders: [] })
        expect(orderNow()).toEqual(['x'])

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'C'])
    })

    test('reproducer T4: the folder is still there but the anchor was removed, so the character goes to the end of that folder', async () => {
        install([F('f1', 'a', 'C', 'b'), 'y'], [mk('a'), mk('C'), mk('b'), mk('y')])
        await trashCharacters({ characters: [listed('C')], folders: [] })
        await removeChar(listed('a'), 'a', 'permanentForce')
        expect(orderNow()).toEqual([F('f1', 'b'), 'y'])

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual([F('f1', 'b', 'C'), 'y'])
    })

    test('guard T5: a profile without trashOrigins restores to the top-level end', () => {
        install(['x', F('f1', 'a')], [mk('x'), mk('a'), mk('C', 5)])

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', F('f1', 'a'), 'C'])
        expect('trashOrigins' in DBState.db).toBe(false)
    })

    test('guard T6: a record written for another trashing of the character is ignored and kept apart from this one', () => {
        install(['x', F('f1', 'a')], [mk('x'), mk('a'), mk('C', 2)], { trashOrigins: [{ chaId: 'C', t: 1, folder: 'f1', after: { char: 'a' } }] })

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', F('f1', 'a'), 'C'])
    })

    test('reproducer T7: a cold stub of the trashed character restores to the place it left', async () => {
        install([F('f1', 'a', 'C', 'b')], [mk('a'), mk('C'), mk('b')])
        await trashCharacters({ characters: [listed('C')], folders: [] })
        const at = DBState.db.characters.findIndex((c) => c.chaId === 'C')
        DBState.db.characters[at] = buildColdStub($state.snapshot(DBState.db.characters[at]) as Ch, 'u1', [])

        restoreCharacterFromTrash(DBState.db.characters[at])

        expect(orderNow()).toEqual([F('f1', 'a', 'C', 'b')])
    })

    test('reproducer T7b (supplementary): a stub the store2 loader builds from its shard entry restores to the place it left', async () => {
        install([F('f1', 'a', 'C', 'b')], [mk('a'), mk('C'), mk('b')])
        await trashCharacters({ characters: [listed('C')], folders: [] })
        const at = DBState.db.characters.findIndex((c) => c.chaId === 'C')
        const entry = { type: 'character', name: 'C', chaId: 'C', creatorNotes: '', u: 'u1', chats: [], trashTime: listed('C').trashTime } as unknown as ShardEntry
        DBState.db.characters[at] = stubFromEntry(entry) as unknown as Ch

        restoreCharacterFromTrash(DBState.db.characters[at])

        expect(orderNow()).toEqual([F('f1', 'a', 'C', 'b')])
    })

    test('guard T10: while saving is held the id is still ordered, and the restore does not add it twice', async () => {
        install(['x', 'C', 'y', 'config'], [mk('x'), mk('C'), mk('y'), mk('config')])
        // An unusable id holds saving, so `checkCharOrder` only adds entries.
        expect(liveCharacterCheck().held).toHaveLength(1)
        await trashCharacters({ characters: [listed('C')], folders: [] })
        expect(orderNow()).toEqual(['x', 'C', 'y', 'config'])

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'C', 'y', 'config'])
    })

    test('reproducer T12: two neighbours trashed together return in their original order when restored one after the other', async () => {
        install(['x', F('f1', 'a', 'A', 'B', 'b')], [mk('x'), mk('a'), mk('A'), mk('B'), mk('b')])
        await trashCharacters({ characters: [listed('A'), listed('B')], folders: [] })
        expect(orderNow()).toEqual(['x', F('f1', 'a', 'b')])

        restoreCharacterFromTrash(listed('A'))
        restoreCharacterFromTrash(listed('B'))

        expect(orderNow()).toEqual(['x', F('f1', 'a', 'A', 'B', 'b')])
    })

    test('rule T13: the next trash prunes the well-formed records no slot matches, and keeps records of an unexpected shape', async () => {
        const odd = [{ foo: 1 }, null, 5, { chaId: 'C' }]
        install(['x', 'C'], [mk('x'), mk('C')], { trashOrigins: [{ chaId: 'gone', t: 1, after: { char: 'x' } }, ...odd] })

        await removeChar(listed('C'), 'C')

        expect(originsNow()).toEqual([...odd, { chaId: 'C', t: listed('C').trashTime, after: { char: 'x' } }])
    })

    test('rule T14: a restore removes the record it used and the stale ones, and keeps a record it does not own', () => {
        const owned = { chaId: 'C', t: 5, after: { char: 'x' } }
        install(['x'], [mk('x'), mk('C', 5), mk('D', 8)], {
            trashOrigins: [owned, { chaId: 'D', t: 8, after: { char: 'x' } }, { chaId: 'stale', t: 1 }, { foo: 1 }],
        })

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'C'])
        expect(originsNow()).toEqual([{ chaId: 'D', t: 8, after: { char: 'x' } }, { foo: 1 }])
    })

    test('rule T14b: twins trashed together share one record, the first restore removes it, and the second twin is not placed again', async () => {
        install(['x', 'C', 'y'], [mk('x'), mk('C'), mk('y')])
        const twin = { ...mk('C') }
        DBState.db.characters.push(twin as Ch)
        const first = listed('C')
        const second = DBState.db.characters[DBState.db.characters.length - 1]
        await trashCharacters({ characters: [first, second], folders: [] })
        expect(orderNow()).toEqual(['x', 'y'])
        expect(originsNow()).toEqual([{ chaId: 'C', t: first.trashTime, after: { char: 'x' } }])

        restoreCharacterFromTrash(first)
        expect(orderNow()).toEqual(['x', 'C', 'y'])
        expect(originsNow()).toEqual([])

        restoreCharacterFromTrash(second)
        expect(orderNow()).toEqual(['x', 'C', 'y'])
    })

    test('guard T16: at restore, a folder id that two folders now share is never entered', () => {
        install([F('x', 'a'), F('x', 'b')], [mk('a'), mk('b'), mk('C', 5)], { trashOrigins: [{ chaId: 'C', t: 5, folder: 'x', after: { char: 'a' } }] })

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual([F('x', 'a'), F('x', 'b'), 'C'])
    })

    test('guard T17: at capture, a folder id that two folders share is not recorded, so a later lone folder with that id is not entered', async () => {
        install([F('x', 'a', 'C'), F('x', 'b')], [mk('a'), mk('C'), mk('b')])
        await trashCharacters({ characters: [listed('C')], folders: [] })
        expect(originsNow()).toBeUndefined()
        // The person deletes the first folder, so one folder with that id is left.
        ;(DBState.db.characterOrder as OrderEntry[]).splice(0, 1, 'a')

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['a', F('x', 'b'), 'C'])
    })

    test('rule T18: twins trashed at different times keep each other\'s record', () => {
        install(['x'], [mk('x'), mk('C', 1), mk('C', 2)], {
            trashOrigins: [{ chaId: 'C', t: 1, after: { char: 'x' } }, { chaId: 'C', t: 2, after: { char: 'x' } }],
        })

        restoreCharacterFromTrash(DBState.db.characters[2])

        expect(originsNow()).toEqual([{ chaId: 'C', t: 1, after: { char: 'x' } }])
    })

    test('guard T19: a trashOrigins that is not an array survives a trash and a restore untouched, and the restore goes to the end', async () => {
        install(['x', 'C', 'y'], [mk('x'), mk('C'), mk('y')], { trashOrigins: {} })

        await trashCharacters({ characters: [listed('C')], folders: [] })
        expect(originsNow()).toEqual({})
        restoreCharacterFromTrash(listed('C'))

        expect(originsNow()).toEqual({})
        expect(orderNow()).toEqual(['x', 'y', 'C'])
    })

    test('rule: records and order entries of an unexpected shape never stop a restore', () => {
        install([null, 5, 'x', 'y'] as unknown as OrderEntry[], [mk('x'), mk('y'), mk('C', 5)], {
            trashOrigins: [null, 5, 'z', { chaId: 'C' }, { chaId: 'C', t: 5, after: { char: 'x' } }],
        })

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'C', 'y'])
        expect(originsNow()).toEqual([null, 5, 'z', { chaId: 'C' }])
    })

    test('guard: a character that is not trashed matches no record, not even one without a t', () => {
        const records = [{ chaId: 'C', folder: 'f1' }]
        install(['x', 'C'], [mk('x'), mk('C')], { trashOrigins: records })

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['x', 'C'])
        expect(originsNow()).toEqual(records)
    })

    test('guard: a picked folder is dissolved, so no record names it and its members return to the top-level end', async () => {
        install([F('f1', 'a', 'C'), 'y'], [mk('a'), mk('C'), mk('y')])

        await trashCharacters({ characters: [listed('C')], folders: [DBState.db.characterOrder[0] as folder] })
        expect(orderNow()).toEqual(['y'])
        expect(originsNow()).toBeUndefined()

        restoreCharacterFromTrash(listed('C'))
        restoreCharacterFromTrash(listed('a'))

        expect(orderNow()).toEqual(['y', 'C', 'a'])
    })

    test('rule: a character picked beside a dissolved folder still records its own place', async () => {
        install([F('f1', 'a'), 'x', 'C', 'y'], [mk('a'), mk('x'), mk('C'), mk('y')])

        await trashCharacters({ characters: [listed('C')], folders: [DBState.db.characterOrder[0] as folder] })
        expect(originsNow()).toEqual([{ chaId: 'C', t: listed('C').trashTime, after: { char: 'x' } }])
    })

    test('guard: capture runs before any order edit, so a character right after a picked folder is anchored on the dissolving folder and returns to the top-level end', async () => {
        install([F('f1', 'a'), 'C'], [mk('a'), mk('C')])

        await trashCharacters({ characters: [listed('C')], folders: [DBState.db.characterOrder[0] as folder] })
        expect(orderNow()).toEqual([])
        // Captured after the splices, C would be first and carry no anchor at all.
        expect(originsNow()).toEqual([{ chaId: 'C', t: listed('C').trashTime, after: { folder: 'f1' } }])

        restoreCharacterFromTrash(listed('C'))

        expect(orderNow()).toEqual(['C'])
    })
})
