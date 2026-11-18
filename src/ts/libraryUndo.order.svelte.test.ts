/**
 * The Undo of a change of the library order (`src/ts/libraryUndo.ts`): a deep "before" copy is written back,
 * through the hosts' own pair (assign `characterOrder`, then `checkCharOrder`), only while the live order still
 * deep-equals the "after" copy; any later change makes it refuse.
 *
 * REAL and unmocked here: `characters.ts`, `globalApi.svelte.ts` (`checkCharOrder`), `sidebarOrder.ts` (the write
 * functions that produce the orders), the toast host, and a real `$state` database. The module-mock set is the one of
 * `libraryUndo.trash.svelte.test.ts`.
 *
 * Titles: "rule" pins behaviour of the new functions and so cannot fail on a base that lacks them.
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
import { copyOrder, foldersLost, orderUndoAction, postOrderUndo, sameOrder, type OrderCopy } from 'src/ts/libraryUndo'
import { editFolder, groupIntoFolder, ungroupFolder, moveManyToGap, type FolderRef } from 'src/lib/SideBars/sidebarOrder'
import { resetToastHostForTests, toastHost } from 'src/ts/toast/toastHost.svelte'
import { language } from 'src/lang'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { Database, folder } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'

//#region fixtures

type Ch = Database['characters'][number]
type OrderEntry = string | folder

const mk = (chaId: string): Ch => ({
    chaId, name: chaId, type: 'character', chatPage: 0,
    chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
}) as unknown as Ch

const F = (id: string, ...data: string[]): folder => ({ id, name: id, color: '', data })
const ch = (id: string) => ({ kind: 'char' as const, id, occurrence: 0 })

function install(order: OrderEntry[], ids: string[]): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], enabledModules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: order, characters: ids.map(mk),
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    selectedCharID.set(-1)
    liveCharacterCheck()
}

const orderNow = (): OrderEntry[] => $state.snapshot(DBState.db.characterOrder) as OrderEntry[]

/** The host's own write: assign the result and repair, as `applyGridOrderChange` does. */
function hostWrite(next: OrderEntry[]): void {
    DBState.db.characterOrder = next
    checkCharOrder()
}

/** One real action with the snapshot rule: copy before, write, copy after. */
function act(next: (order: OrderEntry[]) => OrderEntry[]): { before: OrderCopy, after: OrderCopy } {
    const before = copyOrder(DBState.db.characterOrder)
    hostWrite(next(DBState.db.characterOrder))
    return { before, after: copyOrder(DBState.db.characterOrder) }
}

const group = (order: OrderEntry[]): OrderEntry[] => groupIntoFolder(order, [ch('A'), ch('B')], { id: 'new', name: 'New' })

beforeEach(() => {
    const tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false } as unknown as toSaveType
    installCharacterSaveMarks({ tracker, schedule: vi.fn<() => void>() })
    resetToastHostForTests()
})

afterEach(() => {
    vi.useRealTimers()
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('copyOrder and sameOrder', () => {
    test('rule O1: copyOrder is deep both ways', () => {
        const live = [F('f', 'A', 'B'), 'C']
        const copy = copyOrder(live)
        expect(copy).toEqual(live)
        expect(copy).not.toBe(live)
        expect(copy[0]).not.toBe(live[0])
        ;(live[0] as folder).data.push('Z')
        ;(live[0] as folder).name = 'renamed'
        expect(copy[0]).toEqual(F('f', 'A', 'B'))
        ;(copy[0] as folder).data.splice(0, 1)
        expect((live[0] as folder).data).toEqual(['A', 'B', 'Z'])
        expect(copyOrder(undefined)).toEqual([])
    })

    test('rule O2: sameOrder is false for each kind of change and true for a rebuilt folder with another key order', () => {
        const base: OrderEntry[] = [F('f', 'A', 'B'), 'C']
        expect(sameOrder(base, copyOrder(base))).toBe(true)
        expect(sameOrder(base, [F('f', 'A', 'B')])).toBe(false)
        expect(sameOrder(base, [F('f', 'A', 'B'), 'D'])).toBe(false)
        expect(sameOrder(base, ['C', F('f', 'A', 'B')])).toBe(false)
        expect(sameOrder(base, [F('f', 'B', 'A'), 'C'])).toBe(false)
        expect(sameOrder(base, [F('g', 'A', 'B'), 'C'])).toBe(false)
        expect(sameOrder(base, [{ ...F('f', 'A', 'B'), name: 'x' }, 'C'])).toBe(false)
        expect(sameOrder(base, [{ ...F('f', 'A', 'B'), color: 'red' }, 'C'])).toBe(false)
        expect(sameOrder(base, [{ ...F('f', 'A', 'B'), imgFile: 'p' }, 'C'])).toBe(false)
        expect(sameOrder([F('f', 'A')], ['f'])).toBe(false)
        const rebuilt = { data: ['A', 'B'], color: '', name: 'f', id: 'f' } as folder
        expect(sameOrder(base, [rebuilt, 'C'])).toBe(true)
    })

    test('rule O10: foldersLost counts occurrences of a folder id', () => {
        expect(foldersLost([F('f', 'A'), 'B'], ['B', 'A'])).toBe(true)
        expect(foldersLost([F('f', 'A'), F('f', 'B')], [F('f', 'A', 'B')])).toBe(true)
        expect(foldersLost([F('f', 'A'), 'B'], ['B', F('f', 'A')])).toBe(false)
        expect(foldersLost(['A', 'B'], [F('n', 'A', 'B')])).toBe(false)
        expect(foldersLost([F('f', 'A')], [F('f', 'A'), F('g', 'B')])).toBe(false)
    })
})

describe('order undo', () => {
    test('rule O3: undo of a group puts the exact previous order back, and a second run refuses', () => {
        install(['A', 'B', F('f', 'C', 'D')], ['A', 'B', 'C', 'D'])
        const start = orderNow()
        const { before, after } = act(group)
        expect(orderNow()).not.toEqual(start)
        const action = orderUndoAction('grouped', before, after)
        const first = action.run()
        expect(first).toEqual({ ok: true, text: language.othersUi.libraryUndoOrderRestored })
        expect(orderNow()).toEqual(start)
        expect(action.run()).toEqual({ ok: false, text: language.othersUi.libraryUndoOrderRefused })
        expect(orderNow()).toEqual(start)
    })

    test('rule: undo keeps the folder name, colour, picture and member order of a dissolved folder', () => {
        const rich: folder = { id: 'f', name: 'Fancy', color: 'red', imgFile: 'asset:pic', data: ['C', 'B'] }
        install(['A', rich, F('g', 'D')], ['A', 'B', 'C', 'D'])
        const start = orderNow()
        const into: FolderRef = { kind: 'folder', id: 'g', occurrence: 0 }
        const { before, after } = act((order) => moveManyToGap(order, [{ kind: 'folder', id: 'f', occurrence: 0 }], { in: 'folder', folder: into, after: null }))
        expect(foldersLost(before, after)).toBe(true)
        orderUndoAction('folderRemoved', before, after).run()
        expect(orderNow()).toEqual(start)
        expect(orderNow()[1]).toEqual({ id: 'f', name: 'Fancy', color: 'red', imgFile: 'asset:pic', data: ['C', 'B'] })
    })

    test('rule O4a: refuses after a further move', () => {
        install(['A', 'B', 'C'], ['A', 'B', 'C'])
        const { before, after } = act(group)
        hostWrite(moveManyToGap(DBState.db.characterOrder as OrderEntry[], [ch('C')], { in: 'top', after: null }))
        const moved = orderNow()
        expect(orderUndoAction('grouped', before, after).run()).toEqual({ ok: false, text: language.othersUi.libraryUndoOrderRefused })
        expect(orderNow()).toEqual(moved)
    })

    test('rule O4b: refuses after a rename through editFolder', async () => {
        install(['A', 'B', 'C'], ['A', 'B', 'C'])
        const { before, after } = act(group)
        hostWrite(editFolder(DBState.db.characterOrder as OrderEntry[], 'new', (entry) => { entry.name = 'Renamed' })!)
        const renamed = orderNow()
        expect((await orderUndoAction('grouped', before, after).run()).ok).toBe(false)
        expect(orderNow()).toEqual(renamed)
    })

    test('rule O4c: refuses after a trash of a member that checkCharOrder splices out in place', async () => {
        install(['A', 'B', 'C'], ['A', 'B', 'C'])
        const { before, after } = act(group)
        const member = DBState.db.characters.find((c) => c.chaId === 'A')!
        await removeChar(member, 'A', 'normal')
        const trashed = orderNow()
        expect(trashed).not.toEqual(after)
        expect((await orderUndoAction('grouped', before, after).run()).ok).toBe(false)
        expect(orderNow()).toEqual(trashed)
    })

    test('rule O4d: refuses after checkCharOrder pushed a new character', async () => {
        install(['A', 'B', 'C'], ['A', 'B', 'C'])
        const { before, after } = act(group)
        DBState.db.characters.push(mk('N'))
        checkCharOrder()
        const pushed = orderNow()
        expect(pushed).toContain('N')
        expect((await orderUndoAction('grouped', before, after).run()).ok).toBe(false)
        expect(orderNow()).toEqual(pushed)
    })

    test('rule: undo of an ungroup restores the folder; the texts come from the kind', () => {
        install(['A', F('f', 'B', 'C')], ['A', 'B', 'C'])
        const start = orderNow()
        const ref: FolderRef = { kind: 'folder', id: 'f', occurrence: 0 }
        const { before, after } = act((order) => ungroupFolder(order, ref)!)
        postOrderUndo('ungrouped', before, after)
        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0].kind).toBe('undo')
        expect(toastHost.visible[0].text).toBe(language.othersUi.libraryUndoUngrouped)
        postOrderUndo('movedIntoFolder', before, after, 2)
        expect(toastHost.visible[1].text).toBe(language.othersUi.libraryUndoMovedIntoFolder(2))
        postOrderUndo('folderDeleted', before, after)
        expect(toastHost.visible[2].text).toBe(language.othersUi.libraryUndoFolderDeleted)
        return toastHost.activate(toastHost.visible[0].id).then(() => {
            expect(orderNow()).toEqual(start)
        })
    })

    test('rule: a group undo and a later trash undo coexist: the order undo refuses, nothing else changes', async () => {
        install(['A', 'B', 'C'], ['A', 'B', 'C'])
        const { before, after } = act(group)
        postOrderUndo('grouped', before, after)
        const member = DBState.db.characters.find((c) => c.chaId === 'B')!
        await removeChar(member, 'B', 'normal')
        const trashed = orderNow()
        await toastHost.activate(toastHost.visible[0].id)
        expect(orderNow()).toEqual(trashed)
    })
})
