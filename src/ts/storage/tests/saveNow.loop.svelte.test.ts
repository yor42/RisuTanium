/**
 * `requestSaveNow()` (globalApi.svelte.ts) makes what is marked due at once and
 * wakes the save loop, and the hide trigger uses it to put a streamed reply of
 * a character that is not selected into the store. Which wait the loop is in
 * when the request arrives decides what is proven:
 * - the first tests follow a commit, so they reach the loop's wait after a
 *   step (or the latch that wait spends);
 * - the last test makes the idle wait last 10 s, so it passes only if the
 *   request wakes that idle wait itself.
 * - a request before the loop has installed its scheduler changes nothing.
 * The pre-loop wait has unit-level coverage only (`saveScheduler.test.ts`).
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder` and the
 * page's block-store owner against an in-memory byte store (see
 * `saveLoopWorld.ts`), with the loop's real wait lengths (the kit's shortened
 * sleeps would hide the wake). One save loop runs for the whole file and is
 * parked when the file ends. Change effects are mocked, so a save happens only
 * for an explicit mark. A mocked success here is not evidence of native
 * backend behaviour.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { makeDb, rootWrites } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    worldCount: 0,
    parked: new Set<number>(),
    parkedAll: false,
    /** Makes every 500 ms wait of the loop (the idle wait among them) last 10 s. */
    longIdleWait: false,
    db: undefined as undefined | Record<string, unknown>,
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn((ms: number) => h.parkedAll
        ? new Promise<void>(() => {})
        : new Promise<void>((resolve) => setTimeout(resolve, ms === 500 && h.longIdleWait ? 10_000 : ms))),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))

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
        async setItem(_key: string, _value: Uint8Array) {}
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

import { activeStreams, addActiveStream, resetActiveStreamsForTest } from 'src/ts/process/activeStreams'
import { beginInFlight, resetInFlightForTest } from 'src/ts/process/inFlightWork'
import { installSaveOnHide } from 'src/ts/process/saveOnHide'

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

const SELECTED = 'selected-cha'
const STREAMING = 'streaming-cha'

let w: World
let beforeInstall: { marksBefore: number, marksAfter: number, storeOps: number } | null = null

beforeAll(async () => {
    h.db = makeDb('first', [SELECTED, STREAMING])
    w = await kit.startWorld({ isolate: false, startLoop: false })
    // Asked before the loop has installed its scheduler: nothing happens.
    const marksBefore = w.api.getSaveMarkCount()
    w.api.requestSaveNow()
    beforeInstall = { marksBefore, marksAfter: w.api.getSaveMarkCount(), storeOps: w.store.ops.length }
    w.start()
    await sleepReal(1300)
})

afterAll(() => {
    h.parkedAll = true
    kit.parkAll()
})

function nextCommitAfter(action: () => void): Promise<number> {
    const started = performance.now()
    return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no save commit within 4 s')), 4000)
        w.api.afterNextSaveCommit(() => {
            clearTimeout(timer)
            resolve(performance.now() - started)
        })
        action()
    })
}

describe('requestSaveNow', () => {
    test('before the loop has installed its scheduler it counts no mark and writes nothing', () => {
        expect(beforeInstall).not.toBeNull()
        expect(beforeInstall!.marksAfter).toBe(beforeInstall!.marksBefore)
        expect(beforeInstall!.storeOps).toBe(0)
    })

    test('guard: a mark alone is saved only after the 500 ms debounce', async () => {
        const writesBefore = rootWrites(w.store).length
        h.db!.mainPrompt = 'debounced'
        const elapsed = await nextCommitAfter(() => w.marks.markCharacterForSave(SELECTED))

        expect(elapsed).toBeGreaterThanOrEqual(480)
        expect(rootWrites(w.store).length).toBeGreaterThan(writesBefore)
    })

    test('saves a marked change without waiting out the debounce', async () => {
        const writesBefore = rootWrites(w.store).length
        h.db!.mainPrompt = 'now'
        const elapsed = await nextCommitAfter(() => {
            w.marks.markCharacterForSave(SELECTED)
            w.api.requestSaveNow()
        })

        expect(elapsed).toBeLessThan(400)
        expect(rootWrites(w.store).length).toBeGreaterThan(writesBefore)
    })

    test('a mark after the request is saved by its own debounce and is not lost', async () => {
        w.api.requestSaveNow()
        await sleepReal(100)
        h.db!.mainPrompt = 'after the request'
        const elapsed = await nextCommitAfter(() => w.marks.markCharacterForSave(SELECTED))

        expect(elapsed).toBeGreaterThanOrEqual(480)
    })
})

describe('the hide trigger over the real save loop', () => {
    test('puts a streamed reply of a character that is not selected into the store with its flag', async () => {
        resetInFlightForTest()
        resetActiveStreamsForTest()
        const characters = h.db!.characters as Array<{ chaId: string, chats: Array<{ message: Array<Record<string, unknown>> }> }>
        const streaming = characters.find((c) => c.chaId === STREAMING)!
        // The reply as the stream wrote it into the live data: no change effect saw it.
        streaming.chats[0].message.push({ role: 'char', data: 'Partial text', chatId: 'reply-1', interrupted: true })
        const endChat = beginInFlight('chat')
        const removeStream = addActiveStream({ chaId: STREAMING, replyChatId: 'reply-1' })
        const doc = new EventTarget() as unknown as Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
        Object.defineProperty(doc, 'visibilityState', { value: 'hidden' })
        const uninstall = installSaveOnHide({
            doc,
            win: new EventTarget() as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
            kinds: () => ['chat'],
            streams: activeStreams,
            mark: w.marks.markCharacterForSave,
            saveNow: w.api.requestSaveNow,
        })

        const elapsed = await nextCommitAfter(() => {
            (doc as unknown as EventTarget).dispatchEvent(new Event('visibilitychange'))
        })
        uninstall()
        removeStream()
        endChat()

        expect(elapsed).toBeLessThan(400)
        const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
        const loaded = await w.owner.readCommitted({ validate: validateLoadedBlocks })
        if (loaded.kind !== 'loaded') {
            throw new Error(`the stored profile did not load: ${loaded.kind}`)
        }
        const stored = (loaded.tree as unknown as Database).characters.find((c) => c.chaId === STREAMING)!
        expect(stored.chats[0].message.at(-1)).toMatchObject({ data: 'Partial text', interrupted: true })
    })
})

describe('requestSaveNow while the loop idles', () => {
    test('wakes the idle wait itself: a commit follows at once although that wait lasts 10 s', async () => {
        h.longIdleWait = true
        try {
            // The wait the loop is in ends within 500 ms; the next idle wait lasts 10 s.
            await sleepReal(700)
            const writesBefore = rootWrites(w.store).length
            h.db!.mainPrompt = 'woken from idle'
            const elapsed = await nextCommitAfter(() => {
                w.marks.markCharacterForSave(SELECTED)
                w.api.requestSaveNow()
            })

            expect(elapsed).toBeLessThan(400)
            expect(rootWrites(w.store).length).toBeGreaterThan(writesBefore)
        } finally {
            h.longIdleWait = false
            // Ends the long wait the loop may still be in.
            w.api.requestSaveNow()
        }
    })
})
