/**
 * A group's member record is kept when the member is permanently deleted: neither `removeChar` (type
 * `permanentForce`) nor `removeTrashedCharacters` writes to the group's `risutanium_members`, so a
 * member renamed after it joined still reads as its join-time record once it is gone.
 *
 * Compatibility guard (passes before and after the record existed): the assertions are on the raw map,
 * which these removal paths never touch. REAL and unmocked here: `characters.ts`. The module-mock set is
 * the one of `characters.removeCharFolderPrune.svelte.test.ts`.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
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
    // A plain object: this file is not a .svelte.test.ts, so it cannot use the $state rune.
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

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { liveCharacterCheck } from 'src/ts/globalApi.svelte'
import { removeChar, removeTrashedCharacters } from 'src/ts/characters'
import type { Database } from 'src/ts/storage/database.svelte'

type Ch = Database['characters'][number]

const mk = (chaId: string, name: string, trashTime?: number) => ({
    chaId, name, type: 'character', chatPage: 0,
    chats: [{ id: chaId + '-c', message: [], note: '', name: '', localLore: [] }], trashTime,
}) as unknown as Ch

// The record is hand-seeded in exactly the shape joinRecord writes: {name: string, slot: 0..7} under the
// member's chaId. 'a' joined as "Alice" and has since been renamed "Alicia".
const RECORDS = () => ({ a: { name: 'Alice', slot: 0 }, b: { name: 'Bea', slot: 1 } })

function install() {
    const group = {
        chaId: 'g', name: 'Group', type: 'group', chatPage: 0, characters: ['a', 'b'],
        characterActive: [true, true], characterTalks: [1, 1],
        chats: [{ id: 'g-c', message: [], note: '', name: '', localLore: [] }],
        risutanium_members: RECORDS(),
    } as unknown as Ch
    DBState.db = {
        characters: [group, mk('a', 'Alicia'), mk('b', 'Bea')],
        characterOrder: ['g', 'a', 'b'], modules: [], enabledModules: [],
    } as unknown as Database
    selectedCharID.set(-1)
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    liveCharacterCheck()
}

const listed = (chaId: string) => DBState.db.characters.find((c) => c.chaId === chaId)!
const recordsNow = () => JSON.stringify((listed('g') as unknown as { risutanium_members: unknown }).risutanium_members)

beforeEach(() => {
    install()
})

describe('permanent deletion keeps the group member record', () => {
    test('guard: removeChar permanentForce leaves the record as joined, not as renamed', async () => {
        const before = recordsNow()
        await removeChar(listed('a'), 'Alicia', 'permanentForce')
        expect(DBState.db.characters.some((c) => c.chaId === 'a')).toBe(false)
        expect(recordsNow()).toBe(before)
        expect(JSON.parse(recordsNow())).toEqual(RECORDS())
    })

    test('guard: removeTrashedCharacters leaves the record as joined', async () => {
        listed('b').trashTime = 1234
        const before = recordsNow()
        await removeTrashedCharacters([listed('b')], { matching: false })
        expect(DBState.db.characters.some((c) => c.chaId === 'b')).toBe(false)
        expect(recordsNow()).toBe(before)
        expect(JSON.parse(recordsNow())).toEqual(RECORDS())
    })
})