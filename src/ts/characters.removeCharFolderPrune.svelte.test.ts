/**
 * A folder whose last member id is dropped from the order is itself dropped by the same
 * `checkCharOrder` pass, so `removeChar` (and every other single-pass caller) leaves no empty
 * folder in `DBState.db.characterOrder`. A held save prunes nothing.
 *
 * REAL and unmocked here: `characters.ts` and `globalApi.svelte.ts`. The module-mock set is the
 * one of `characters.trashFolderMembers.svelte.test.ts`.
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
import { checkCharOrder, liveCharacterCheck } from 'src/ts/globalApi.svelte'
import { removeChar } from 'src/ts/characters'
import type { Database } from 'src/ts/storage/database.svelte'

type Ch = Database['characters'][number]
type Folder = { id: string, name: string, color: string, data: string[] }

const mk = (chaId: string, trashTime?: number) => ({
    chaId, name: chaId, type: 'character', chatPage: 0,
    chats: [{ id: chaId + '-c', message: [], note: '', name: '', localLore: [] }], trashTime,
}) as unknown as Ch
const folderOf = (...data: string[]): Folder => ({ id: 'F', name: 'F', color: '', data })

function install(order: (string | Folder)[], chars: Ch[]) {
    DBState.db = { characters: chars, characterOrder: order, modules: [], enabledModules: [] } as unknown as Database
    selectedCharID.set(-1)
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    // The check also resets the hold a previous test left on `checkCharOrder`.
    liveCharacterCheck()
}
// `removeChar` resolves a character object by reference, so it needs the reactive entry.
const listed = (chaId: string) => DBState.db.characters.find((c) => c.chaId === chaId)!
const orderNow = () => $state.snapshot(DBState.db.characterOrder) as (string | Folder)[]

describe('a folder emptied by the order pruning is removed in the same pass', () => {
    test('checkCharOrder removes a folder whose last member is trashed, in one pass', () => {
        install([folderOf('a'), 'b'], [mk('a', 1), mk('b')])
        checkCharOrder()
        expect(orderNow()).toEqual(['b'])
    })

    test('checkCharOrder removes a folder whose last member no longer exists, in one pass', () => {
        install([folderOf('gone'), 'b'], [mk('b')])
        checkCharOrder()
        expect(orderNow()).toEqual(['b'])
    })

    test('removeChar (normal) of the last untrashed member leaves no empty folder', async () => {
        install([folderOf('a'), 'b'], [mk('a'), mk('b')])
        await removeChar(listed('a'), 'a')
        expect(listed('a').trashTime).toBeGreaterThan(0)
        expect(orderNow()).toEqual(['b'])
    })

    test('removeChar (permanentForce) of the last member leaves no empty folder', async () => {
        install([folderOf('a'), 'b'], [mk('a'), mk('b')])
        await removeChar(listed('a'), 'a', 'permanentForce')
        expect(orderNow()).toEqual(['b'])
    })

    test('a folder with remaining members is kept, minus the removed id', async () => {
        install([folderOf('a', 'c'), 'b'], [mk('a'), mk('b'), mk('c')])
        await removeChar(listed('a'), 'a')
        expect(orderNow()).toEqual([folderOf('c'), 'b'])
    })

    test('adjacent emptied folders are all removed in one pass', () => {
        install([folderOf('a'), { ...folderOf('c'), id: 'G' }, 'b'], [mk('a', 1), mk('c', 1), mk('b')])
        checkCharOrder()
        expect(orderNow()).toEqual(['b'])
    })

    test('an emptied folder followed by a stale id leaves neither behind', () => {
        install([folderOf('a'), 'gone', 'b'], [mk('a', 1), mk('b')])
        checkCharOrder()
        expect(orderNow()).toEqual(['b'])
    })

    test('an emptied folder after a kept entry does not overwrite that entry', () => {
        install(['b', folderOf('a')], [mk('a', 1), mk('b')])
        checkCharOrder()
        expect(orderNow()).toEqual(['b'])
    })

    test('a held save prunes nothing, so an emptied folder is not touched', () => {
        install([folderOf('a'), 'b'], [mk('a', 1), mk('b')])
        DBState.db.characters.push({ ...mk('x'), chaId: undefined, coldstorage: 'cold' } as unknown as Ch)
        expect(liveCharacterCheck().held).toHaveLength(1)
        checkCharOrder()
        expect(orderNow()).toEqual([folderOf('a'), 'b'])
    })
})
