/**
 * `isSaveClean()` (globalApi.svelte.ts) is true only when everything marked so
 * far is in the store: the last save iteration committed, no save has been
 * requested since that iteration's snapshot, and nothing is running, debounced,
 * stopped or frozen.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder` and the
 * page's block-store owner against an in-memory byte store (see
 * `saveLoopWorld.ts`). One save loop runs for the whole file and is parked when
 * the file ends. A mocked success here is not evidence of native backend
 * behaviour.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { isBackupKey, isRootKey, makeDb, rootWrites } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'

const h = vi.hoisted(() => ({
    worldCount: 0,
    parked: new Set<number>(),
    holdRoot: null as null | Promise<void>,
    rootHeld: false,
    holdAssetWrite: null as null | Promise<void>,
    rootAttempts: 0,
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
        async setItem(key: string, _value: Uint8Array) {
            if (key.startsWith('assets/') && h.holdAssetWrite) {
                await h.holdAssetWrite
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

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

const CHA_ID = 'skip-cha'

let w: World
let startedBeforeLoop = false

const becomesClean = () => vi.waitFor(() => {
    expect(w.api.isSaveClean()).toBe(true)
}, { timeout: 8000, interval: 10 })

const commits = () => rootWrites(w.store).length

/** Counts every attempt at the commit's last write, landed or refused. */
function watchRootAttempts() {
    w.store.faults.push({
        match: (op) => {
            if (op.kind === 'write' && isRootKey(op.key)) {
                h.rootAttempts++
            }
            return false
        },
        mode: 'before',
        times: Number.MAX_SAFE_INTEGER,
    })
}

beforeAll(async () => {
    h.db = makeDb('first')
    w = await kit.startWorld({ startLoop: false })
    startedBeforeLoop = w.api.isSaveClean()
    watchRootAttempts()
    w.store.gate = async (key) => {
        if (isRootKey(key) && h.holdRoot) {
            h.rootHeld = true
            await h.holdRoot
        }
    }
    w.start()
    await sleepReal(100)
})

afterAll(() => {
    kit.parkAll()
})

describe('saveAsset', () => {
    test('counts as a write in flight until its store write settles, and again as none after', async () => {
        const { chokePointInFlight } = await import('src/ts/process/memory/busyActions')
        let release: () => void = () => {}
        h.holdAssetWrite = new Promise<void>((resolve) => { release = resolve })

        const pending = w.api.saveAsset(new Uint8Array([1, 2, 3]), 'in-flight-asset', 'png')
        await vi.waitFor(() => {
            expect(chokePointInFlight('asset')).toBe(1)
        }, { timeout: 2000, interval: 5 })

        h.holdAssetWrite = null
        release()
        await pending
        expect(chokePointInFlight('asset')).toBe(0)
    })

    test('a value that is not bytes is refused without leaving a count behind', async () => {
        const { chokePointInFlight } = await import('src/ts/process/memory/busyActions')
        await expect(w.api.saveAsset('not bytes' as unknown as Uint8Array)).rejects.toThrow(TypeError)
        expect(chokePointInFlight('asset')).toBe(0)
    })
})

describe('isSaveClean', () => {
    test('is false before the save loop has committed anything', () => {
        expect(startedBeforeLoop).toBe(false)
        expect(w.api.isSaveClean()).toBe(false)
    })

    test('is clean after a save whose backup write fails, because the commit already holds the data', async () => {
        w.store.faults.push({ match: (op) => op.kind === 'write' && isBackupKey(op.key), mode: 'before', times: 1 })
        h.db!.mainPrompt = 'second'
        w.marks.markCharacterForSave(CHA_ID)
        await becomesClean()
    })

    test('is not clean right after a mark, and clean again once the save commits', async () => {
        h.db!.mainPrompt = 'third'
        w.marks.markCharacterForSave(CHA_ID)
        expect(w.api.isSaveClean()).toBe(false)
        await becomesClean()
    })

    test('a callback registered for the next commit is not called by a failed save and is called once by the save that commits', async () => {
        const callback = vi.fn()
        const attemptsBefore = h.rootAttempts
        const failing = { match: (op: { kind: string, key: string }) => op.kind === 'write' && isRootKey(op.key), mode: 'before' as const, times: 1000 }
        w.store.faults.push(failing)
        w.api.afterNextSaveCommit(callback)
        h.db!.mainPrompt = 'fails again'
        w.marks.markCharacterForSave(CHA_ID)
        await vi.waitFor(() => {
            expect(h.rootAttempts - attemptsBefore).toBeGreaterThanOrEqual(2)
        }, { timeout: 8000, interval: 10 })
        expect(callback).not.toHaveBeenCalled()
        failing.times = 0
        await becomesClean()
        expect(callback).toHaveBeenCalledTimes(1)
        h.db!.mainPrompt = 'third'
        w.marks.markCharacterForSave(CHA_ID)
        await becomesClean()
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('a change followed by a change back is not clean until a later save commits, and that save commits nothing', async () => {
        const before = commits()
        h.db!.mainPrompt = 'changed'
        w.marks.markCharacterForSave(CHA_ID)
        h.db!.mainPrompt = 'third'
        w.marks.markCharacterForSave(CHA_ID)
        expect(w.api.isSaveClean()).toBe(false)
        await becomesClean()
        expect(commits()).toBe(before)
    })

    test('an edit marked while a save is in flight is not clean when that save commits, only after the next one', async () => {
        let release: () => void = () => {}
        h.holdRoot = new Promise<void>((resolve) => { release = resolve })
        const before = commits()
        h.db!.mainPrompt = 'in flight'
        w.marks.markCharacterForSave(CHA_ID)
        await vi.waitFor(() => {
            expect(h.rootHeld).toBe(true)
        }, { timeout: 4000, interval: 10 })

        h.db!.mainPrompt = 'edited during the save'
        w.marks.markCharacterForSave(CHA_ID)
        h.holdRoot = null
        release()

        let cleanBeforeSecondCommit = false
        const sampler = setInterval(() => {
            if (w.api.isSaveClean() && commits() < before + 2) {
                cleanBeforeSecondCommit = true
            }
        }, 1)
        await becomesClean()
        clearInterval(sampler)
        expect(cleanBeforeSecondCommit).toBe(false)
        expect(commits()).toBeGreaterThanOrEqual(before + 2)
    })

    test('is not clean after a failed save, and clean once a retry commits', async () => {
        const attemptsBefore = h.rootAttempts
        const failing = { match: (op: { kind: string, key: string }) => op.kind === 'write' && isRootKey(op.key), mode: 'before' as const, times: 1000 }
        w.store.faults.push(failing)
        h.db!.mainPrompt = 'fails'
        w.marks.markCharacterForSave(CHA_ID)
        await vi.waitFor(() => {
            expect(h.rootAttempts - attemptsBefore).toBeGreaterThanOrEqual(2)
        }, { timeout: 8000, interval: 10 })
        expect(w.api.isSaveClean()).toBe(false)
        failing.times = 0
        await becomesClean()
    })

    test('an iteration that bails out before committing is not committed, so the tab is not clean', async () => {
        const characters = h.db!.characters
        const attemptsBefore = h.rootAttempts
        h.db!.characters = undefined
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(150)
        expect(h.rootAttempts).toBe(attemptsBefore)
        expect(w.api.isSaveClean()).toBe(false)

        h.db!.characters = characters
        w.marks.markCharacterForSave(CHA_ID)
        await becomesClean()
    })

    test('is not clean while a full encoder reload is requested', async () => {
        await becomesClean()
        w.api.requiresFullEncoderReload.state = true
        expect(w.api.isSaveClean()).toBe(false)
        w.api.requiresFullEncoderReload.state = false
        expect(w.api.isSaveClean()).toBe(true)
    })

    test('is not clean while saving is stopped or a chaId is frozen', async () => {
        const stores = await import('src/ts/stores.svelte')
        await becomesClean()
        stores.savingStoppedReason.set('stay')
        expect(w.api.isSaveClean()).toBe(false)
        stores.savingStoppedReason.set(null)
        expect(w.api.isSaveClean()).toBe(true)

        stores.frozenSaveKeysStore.set([{ chaId: CHA_ID } as never])
        expect(w.api.isSaveClean()).toBe(false)
        stores.frozenSaveKeysStore.set([])
        expect(w.api.isSaveClean()).toBe(true)
    })
})
