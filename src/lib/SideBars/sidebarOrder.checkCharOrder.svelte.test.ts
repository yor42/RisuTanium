/**
 * The result of a sidebar order operation, run through the REAL `checkCharOrder`
 * (`src/ts/globalApi.svelte.ts`), which the sidebar calls after every drop. The operations
 * return an order that may still hold unknown ids, duplicates and folders; `checkCharOrder`
 * then drops unknown ids and empty folders, appends missing characters, and keeps
 * duplicates, as it always has.
 *
 * The module-mock set is copied from `src/ts/checkCharOrder.tempCharacter.svelte.test.ts`,
 * which loads the real `globalApi.svelte.ts` for the same reason: `checkCharOrder` reads and
 * writes `DBState.db` directly.
 */
import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks -- copied from checkCharOrder.tempCharacter.svelte.test.ts

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
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
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

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
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

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import { checkCharOrder } from 'src/ts/globalApi.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { Database, folder } from 'src/ts/storage/database.svelte'
import { dropOnItem, moveToGap, type OrderEntry } from './sidebarOrder'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string): CharacterFixture {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function setDb(order: OrderEntry[], ids: string[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: ids.map(makeCharacter),
    } as unknown as Database
}

const f = (id: string, data: string[]): folder => ({ id, name: `n-${id}`, color: '', data })

function show(order: readonly OrderEntry[]): string[] {
    return order.map((e) => (e === null ? 'null' : typeof e === 'string' ? e : `${e.id}[${e.data.join(',')}]`))
}

/** The sidebar's write path: assign the operation result, then run `checkCharOrder`. */
function apply(next: OrderEntry[]): string[] {
    DBState.db.characterOrder = next as unknown as Database['characterOrder']
    checkCharOrder()
    return show($state.snapshot(DBState.db.characterOrder) as unknown as OrderEntry[])
}

describe('sidebar order operations followed by the real checkCharOrder', () => {
    const IDS = ['A', 'B', 'C', 'D']

    test('an unknown id before the rows is dropped by checkCharOrder and the move lands where it was dropped', () => {
        setDb(['stale', 'A', 'B', 'C'], IDS)
        const result = moveToGap(DBState.db.characterOrder as OrderEntry[], { kind: 'char', id: 'C', occurrence: 0 }, { in: 'top', after: { kind: 'char', id: 'A', occurrence: 0 } })
        expect(apply(result)).toEqual(['A', 'C', 'B', 'D'])
    })

    test('moving the last member out of a folder leaves no empty folder', () => {
        setDb(['A', f('f1', ['B'])], IDS)
        const result = moveToGap(
            DBState.db.characterOrder as OrderEntry[],
            { kind: 'member', folder: { kind: 'folder', id: 'f1', occurrence: 0 }, id: 'B', occurrence: 0 },
            { in: 'top', after: null },
        )
        expect(apply(result)).toEqual(['B', 'A', 'C', 'D'])
    })

    test('a new folder from two characters survives, with the characters not in the order appended', () => {
        setDb(['A', 'B'], IDS)
        const result = dropOnItem(
            DBState.db.characterOrder as OrderEntry[],
            { kind: 'char', id: 'B', occurrence: 0 },
            { kind: 'char', id: 'A', occurrence: 0 },
            { id: 'new', name: 'New Folder' },
        )
        expect(apply(result)).toEqual(['new[B,A]', 'C', 'D'])
    })

    test('a duplicate entry is moved by occurrence and checkCharOrder keeps both', () => {
        setDb(['A', 'B', 'A', 'C', 'D'], IDS)
        const result = moveToGap(DBState.db.characterOrder as OrderEntry[], { kind: 'char', id: 'A', occurrence: 1 }, { in: 'top', after: { kind: 'char', id: 'D', occurrence: 0 } })
        expect(apply(result)).toEqual(['A', 'B', 'C', 'D', 'A'])
    })

    test('an unknown member inside a folder is dropped by checkCharOrder while the move lands correctly', () => {
        setDb([f('f1', ['stale', 'A', 'B', 'C']), 'D'], IDS)
        const result = moveToGap(
            DBState.db.characterOrder as OrderEntry[],
            { kind: 'member', folder: { kind: 'folder', id: 'f1', occurrence: 0 }, id: 'C', occurrence: 0 },
            { in: 'folder', folder: { kind: 'folder', id: 'f1', occurrence: 0 }, after: { kind: 'member', folder: { kind: 'folder', id: 'f1', occurrence: 0 }, id: 'A', occurrence: 0 } },
        )
        expect(apply(result)).toEqual(['f1[A,C,B]', 'D'])
    })
})
