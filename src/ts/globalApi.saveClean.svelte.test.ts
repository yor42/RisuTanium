/**
 * `isSaveClean()` (globalApi.svelte.ts) is true only when everything marked so
 * far is in the main file: the last save iteration committed its main-file
 * write, no save has been requested since that iteration's snapshot, and
 * nothing is running, debounced, stopped or frozen.
 *
 * This file drives the REAL, unmocked `saveDb()` loop and `RisuSaveEncoder`
 * against a key/value stand-in for `forageStorage` (the harness of
 * `globalApi.saveDbMainFileRecord.svelte.test.ts`). One save loop runs for the
 * whole file and is parked when the file ends. A mocked success here is not
 * evidence of native backend behaviour.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    parked: false,
    failMainWrite: false,
    failBackupWrite: false,
    holdMainWrite: null as null | Promise<void>,
    holdAssetWrite: null as null | Promise<void>,
    mainWriteAttempts: 0,
    mainWritesDone: 0,
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
                if (h.holdMainWrite) {
                    await h.holdMainWrite
                }
                if (h.failMainWrite) {
                    throw new Error('simulated storage write failure')
                }
                h.mainWritesDone++
            }
            else if (key.startsWith('database/dbbackup-') && h.failBackupWrite) {
                throw new Error('simulated backup write failure')
            }
            else if (key.startsWith('assets/') && h.holdAssetWrite) {
                await h.holdAssetWrite
            }
            void value
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
    matchesMainFileRecord: vi.fn(async () => false),
    getMainFileRecordDigest: vi.fn(async () => null),
    digestMainFileBytes: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

import { afterNextSaveCommit, forageStorage, isSaveClean, requiresFullEncoderReload, saveAsset, saveDb } from 'src/ts/globalApi.svelte'
import { chokePointInFlight } from 'src/ts/process/memory/busyActions'
import { frozenSaveKeysStore, savingStoppedReason } from 'src/ts/stores.svelte'
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

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const becomesClean = () => vi.waitFor(() => {
    expect(isSaveClean()).toBe(true)
}, { timeout: 8000, interval: 10 })

let startedBeforeLoop = false

beforeAll(async () => {
    h.db = makeDb('first')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
    startedBeforeLoop = isSaveClean()
    void saveDb()
    await sleepReal(100)
})

afterAll(() => {
    h.parked = true
})

describe('saveAsset', () => {
    test('counts as a write in flight until its store write settles, and again as none after', async () => {
        let release: () => void = () => {}
        h.holdAssetWrite = new Promise<void>((resolve) => { release = resolve })

        const pending = saveAsset(new Uint8Array([1, 2, 3]), 'in-flight-asset', 'png')
        await vi.waitFor(() => {
            expect(chokePointInFlight('asset')).toBe(1)
        }, { timeout: 2000, interval: 5 })

        h.holdAssetWrite = null
        release()
        await pending
        expect(chokePointInFlight('asset')).toBe(0)
    })

    test('a value that is not bytes is refused without leaving a count behind', async () => {
        await expect(saveAsset('not bytes' as unknown as Uint8Array)).rejects.toThrow(TypeError)
        expect(chokePointInFlight('asset')).toBe(0)
    })
})

describe('isSaveClean', () => {
    test('is false before the save loop has committed anything', () => {
        expect(startedBeforeLoop).toBe(false)
        expect(isSaveClean()).toBe(false)
    })

    test('is clean after a save whose backup write fails, because the main file already holds the data', async () => {
        h.failBackupWrite = true
        h.db!.mainPrompt = 'second'
        markCharacterForSave(CHA_ID)
        await becomesClean()
        h.failBackupWrite = false
    })

    test('is not clean right after a mark, and clean again once the save commits', async () => {
        h.db!.mainPrompt = 'third'
        markCharacterForSave(CHA_ID)
        expect(isSaveClean()).toBe(false)
        await becomesClean()
    })

    test('a callback registered for the next commit is not called by a failed save and is called once by the save that commits', async () => {
        const callback = vi.fn()
        const attemptsBefore = h.mainWriteAttempts
        h.failMainWrite = true
        afterNextSaveCommit(callback)
        h.db!.mainPrompt = 'fails again'
        markCharacterForSave(CHA_ID)
        await vi.waitFor(() => {
            expect(h.mainWriteAttempts - attemptsBefore).toBeGreaterThanOrEqual(2)
        }, { timeout: 8000, interval: 10 })
        expect(callback).not.toHaveBeenCalled()
        h.failMainWrite = false
        await becomesClean()
        expect(callback).toHaveBeenCalledTimes(1)
        h.db!.mainPrompt = 'third'
        markCharacterForSave(CHA_ID)
        await becomesClean()
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('a change followed by a change back is not clean until a later save commits, and that save writes no main file', async () => {
        const doneBefore = h.mainWritesDone
        h.db!.mainPrompt = 'changed'
        markCharacterForSave(CHA_ID)
        h.db!.mainPrompt = 'third'
        markCharacterForSave(CHA_ID)
        expect(isSaveClean()).toBe(false)
        await becomesClean()
        expect(h.mainWritesDone).toBe(doneBefore)
    })

    test('an edit marked while a save is in flight is not clean when that save commits, only after the next one', async () => {
        let release: () => void = () => {}
        h.holdMainWrite = new Promise<void>((resolve) => { release = resolve })
        const attemptsBefore = h.mainWriteAttempts
        const doneBefore = h.mainWritesDone
        h.db!.mainPrompt = 'in flight'
        markCharacterForSave(CHA_ID)
        await vi.waitFor(() => {
            expect(h.mainWriteAttempts).toBeGreaterThan(attemptsBefore)
        }, { timeout: 4000, interval: 10 })

        h.db!.mainPrompt = 'edited during the save'
        markCharacterForSave(CHA_ID)
        h.holdMainWrite = null
        release()

        let cleanBeforeSecondCommit = false
        const sampler = setInterval(() => {
            if (isSaveClean() && h.mainWritesDone < doneBefore + 2) {
                cleanBeforeSecondCommit = true
            }
        }, 1)
        await becomesClean()
        clearInterval(sampler)
        expect(cleanBeforeSecondCommit).toBe(false)
        expect(h.mainWritesDone).toBeGreaterThanOrEqual(doneBefore + 2)
    })

    test('is not clean after a failed save, and clean once a retry commits', async () => {
        const attemptsBefore = h.mainWriteAttempts
        h.failMainWrite = true
        h.db!.mainPrompt = 'fails'
        markCharacterForSave(CHA_ID)
        await vi.waitFor(() => {
            expect(h.mainWriteAttempts - attemptsBefore).toBeGreaterThanOrEqual(2)
        }, { timeout: 8000, interval: 10 })
        expect(isSaveClean()).toBe(false)
        h.failMainWrite = false
        await becomesClean()
    })

    test('an iteration that bails out before writing is not committed, so the tab is not clean', async () => {
        const characters = h.db!.characters
        const attemptsBefore = h.mainWriteAttempts
        h.db!.characters = undefined
        markCharacterForSave(CHA_ID)
        await sleepReal(150)
        expect(h.mainWriteAttempts).toBe(attemptsBefore)
        expect(isSaveClean()).toBe(false)

        h.db!.characters = characters
        markCharacterForSave(CHA_ID)
        await becomesClean()
    })

    test('is not clean while a full encoder reload is requested', async () => {
        await becomesClean()
        requiresFullEncoderReload.state = true
        expect(isSaveClean()).toBe(false)
        requiresFullEncoderReload.state = false
        expect(isSaveClean()).toBe(true)
    })

    test('is not clean while saving is stopped or a chaId is frozen', async () => {
        await becomesClean()
        savingStoppedReason.set('stay')
        expect(isSaveClean()).toBe(false)
        savingStoppedReason.set(null)
        expect(isSaveClean()).toBe(true)

        frozenSaveKeysStore.set([{ chaId: CHA_ID } as never])
        expect(isSaveClean()).toBe(false)
        frozenSaveKeysStore.set([])
        expect(isSaveClean()).toBe(true)
    })
})
