/**
 * Guard: the Node server's body limit does not apply on other platforms. With
 * the limit module lowered to 4 KiB, a web-platform `saveDb()` still writes a
 * main file far over it, writes its numbered backup and neither shows a
 * message nor stops saving. The real `saveDb()` loop and `RisuSaveEncoder` run
 * against a key/value stand-in for `forageStorage` (the harness of
 * `globalApi.saveClean.svelte.test.ts`). One save loop runs for the whole file
 * and is parked when the file ends.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    parked: false,
    mainWriteAttempts: 0,
    mainWritesDone: 0,
    backupWrites: 0,
    mainBytes: 0,
    db: undefined as undefined | Record<string, unknown>,
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

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 4096,
}))

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
        savingStoppedReason: writable(''),
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
                h.mainWritesDone++
                h.mainBytes = value.length
            }
            else if (key.startsWith('database/dbbackup-')) {
                h.backupWrites++
            }
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

vi.mock(import('src/ts/storage/mainFileRecord'), () => ({
    noteMainFileBytes: vi.fn(),
    resetMainFileRecordForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

import { forageStorage, saveDb } from 'src/ts/globalApi.svelte'
import { alertToast } from 'src/ts/alert'
import { savingStoppedReason } from 'src/ts/stores.svelte'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

const CHA_ID = 'clean-cha'

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
            name: 'Clean',
            type: 'character',
            chatPage: 0,
            chats: [{ id: 'clean-chat', message: [], note: '', name: '', localLore: [] }],
        }],
    }
}

function incompressible(length: number): string {
    let state = 12345
    let out = ''
    while (out.length < length) {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        out += state.toString(36)
    }
    return out.slice(0, length)
}

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
    h.db = makeDb('first')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
    void saveDb()
    await sleepReal(100)
})

afterAll(() => {
    h.parked = true
})

describe('saveDb on a platform other than the Node server', () => {
    test('a main file over the Node body limit is written and backed up, with no message and no stopped-saving reason', async () => {
        const doneBefore = h.mainWritesDone
        const backupsBefore = h.backupWrites
        h.db!.mainPrompt = incompressible(8192)
        markCharacterForSave(CHA_ID)
        await vi.waitFor(() => { expect(h.mainWritesDone).toBe(doneBefore + 1) }, { timeout: 8000, interval: 10 })
        await vi.waitFor(() => { expect(h.backupWrites).toBe(backupsBefore + 1) }, { timeout: 8000, interval: 10 })
        await sleepReal(100)

        expect(h.backupWrites).toBe(backupsBefore + 1)
        expect(h.mainWriteAttempts).toBe(h.mainWritesDone)
        expect(h.mainBytes).toBeGreaterThan(4096)
        expect(get(savingStoppedReason)).toBe('')
        expect(alertToast).not.toHaveBeenCalled()
    })
})