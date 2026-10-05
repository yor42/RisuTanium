/**
 * The record of the main file (`noteMainFileBytes`) always names bytes that
 * storage really holds: `saveDb()` records exactly the bytes it wrote after
 * the write to `database/database.bin` succeeded, and records nothing while
 * that write fails.
 *
 * This file drives the REAL, unmocked `saveDb()` loop and `RisuSaveEncoder`
 * against a key/value stand-in for `forageStorage`; `noteMainFileBytes` is the
 * observed boundary. One save loop runs for the whole file (it never returns),
 * and it is parked when the file ends. The stand-in `sleep` is a short real
 * timer so the loop yields to the event loop. A mocked success here is not
 * evidence of native backend behaviour.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    parked: false,
    failMainWrite: false,
    writes: [] as Array<{ key: string, value: Uint8Array }>,
    mainWriteAttempts: 0,
    db: undefined as undefined | Record<string, unknown>,
    note: undefined as undefined | ((bytes: Uint8Array) => void),
}))

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
    getDatabase: vi.fn(() => h.db),
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
        frozenSaveKeysStore: writable([]),
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
    sleep: vi.fn((ms: number) => h.parked
        ? new Promise<void>(() => {})
        : new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5)))),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
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
        async getItem(_key: string) { return null }
        async setItem(key: string, value: Uint8Array) {
            if (key === 'database/database.bin') {
                h.mainWriteAttempts++
                if (h.failMainWrite) {
                    throw new Error('simulated storage write failure')
                }
            }
            h.writes.push({ key, value })
        }
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
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

// The observed boundary: what the save loop tells the main-file record.
vi.mock(import('src/ts/storage/mainFileRecord'), () => {
    const note = vi.fn((bytes: Uint8Array) => { h.note?.(bytes) })
    return {
        noteMainFileBytes: note,
        resetMainFileRecordForTests: vi.fn(),
        matchesMainFileRecord: vi.fn(async () => false),
        getMainFileRecordDigest: vi.fn(async () => null),
        digestMainFileBytes: vi.fn(async () => null),
    } as unknown as typeof import('src/ts/storage/mainFileRecord')
})

import { forageStorage, saveDb } from 'src/ts/globalApi.svelte'
import { noteMainFileBytes } from 'src/ts/storage/mainFileRecord'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

const CHA_ID = 'saved-cha'

function makeDb(prompt: string): Record<string, unknown> {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: prompt,
        characters: [{
            chaId: CHA_ID,
            name: 'Saved',
            type: 'character',
            chatPage: 0,
            chats: [{ id: 'saved-chat', message: [], note: '', name: '', localLore: [] }],
        }],
    }
}

/** Marks the character changed and waits for the save loop to attempt the main file write. */
async function requestSave(attemptsBefore: number, attemptsWanted: number): Promise<void> {
    markCharacterForSave(CHA_ID)
    await vi.waitFor(() => {
        expect(h.mainWriteAttempts - attemptsBefore).toBeGreaterThanOrEqual(attemptsWanted)
    }, { timeout: 8000, interval: 20 })
}

function mainWrites(): Uint8Array[] {
    return h.writes.filter((w) => w.key === 'database/database.bin').map((w) => w.value)
}

beforeAll(async () => {
    h.db = makeDb('first')
    // The save loop writes through the page's byte store; here it is the key/value stand-in above.
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
    // The save loop never returns; it is only awaited far enough to be running.
    void saveDb()
    // Let the boot encode and the loop's first idle pass happen.
    await new Promise((resolve) => setTimeout(resolve, 100))
})

afterAll(() => {
    h.parked = true
})

describe('the main-file record after saveDb writes the main file', () => {
    test('records exactly the bytes that were written once the write succeeded', async () => {
        vi.mocked(noteMainFileBytes).mockClear()
        h.db!.mainPrompt = 'second'
        await requestSave(h.mainWriteAttempts, 1)
        await vi.waitFor(() => {
            expect(vi.mocked(noteMainFileBytes)).toHaveBeenCalled()
        }, { timeout: 4000, interval: 20 })

        const written = mainWrites().at(-1)!
        const noted = vi.mocked(noteMainFileBytes).mock.calls.at(-1)![0]
        expect(Array.from(noted)).toEqual(Array.from(written))
    })

    test('guard: records nothing while the main file write fails', async () => {
        vi.mocked(noteMainFileBytes).mockClear()
        h.failMainWrite = true
        h.db!.mainPrompt = 'third'
        const attemptsBefore = h.mainWriteAttempts
        await requestSave(attemptsBefore, 2)
        h.failMainWrite = false

        expect(mainWrites().length).toBeGreaterThan(0)
        expect(vi.mocked(noteMainFileBytes)).not.toHaveBeenCalled()
    })
})
