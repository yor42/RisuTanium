/**
 * S14: `mergeUnsavedChanges` -- pure merge-back-without-loss-or-duplication.
 * Also `sweepDraftRegistrations`, the orphan draft-registration sweep the store2 loop runs every pass.
 *
 * This file drives the REAL, unmocked `src/ts/globalApi.svelte.ts`. The module-mock set below is
 * copied, trimmed to what these functions' own dependency graph
 * actually needs, from `src/ts/globalApiFileCacheAv3.svelte.test.ts` (the
 * existing precedent for loading this same huge module for real).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks -- trimmed from globalApiFileCacheAv3.svelte.test.ts

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

import {
    mergeUnsavedChanges,
    sweepDraftRegistrations,
} from 'src/ts/globalApi.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { draftContentOrphanGate, DRAFT_CONTENT_ORPHAN_CAP_MS } from 'src/ts/draftContentOrphanGate'
import { hasLocalDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import type { MessageIdentity } from 'src/ts/draftContents'

//#region fixtures

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('mergeUnsavedChanges — S14', () => {
    test('a mark added between the snapshot and the end of set() survives into the next save, without duplication', () => {
        const live = makeTracker()
        // Accumulated AFTER the snapshot was taken (e.g. during the in-flight write).
        live.character = ['char-new']
        live.chat = [['char-new', 'chat-1']]

        const toSave = makeTracker()
        toSave.character = ['char-old', 'char-new'] // char-new overlaps -- must not duplicate
        toSave.chat = [['char-old', 'chat-0']]
        toSave.botPreset = true
        toSave.modules = true

        mergeUnsavedChanges(live, toSave)

        expect(live.character).toEqual(['char-new', 'char-old'])
        expect(live.chat).toEqual([['char-new', 'chat-1'], ['char-old', 'chat-0']])
        expect(live.botPreset).toBe(true)
        expect(live.modules).toBe(true)
        expect(live.loadouts).toBe(false)
    })

    test('a failed save (live tracker already trimmed/reset) merges the whole snapshot back without loss', () => {
        const live = makeTracker() // as if just trimmed to empty by the save pass's snapshot
        const toSave = makeTracker()
        toSave.character = ['char-a', 'char-b']
        toSave.chat = [['char-a', 'chat-0'], ['char-b', 'chat-1']]
        toSave.plugins = true
        toSave.pluginCustomStorage = true

        mergeUnsavedChanges(live, toSave)

        expect(live.character).toEqual(['char-a', 'char-b'])
        expect(live.chat).toEqual([['char-a', 'chat-0'], ['char-b', 'chat-1']])
        expect(live.plugins).toBe(true)
        expect(live.pluginCustomStorage).toBe(true)
    })

    test('does not duplicate a chat pair that already exists in the live tracker', () => {
        const live = makeTracker()
        live.chat = [['char-a', 'chat-0']]
        const toSave = makeTracker()
        toSave.chat = [['char-a', 'chat-0'], ['char-b', 'chat-2']]

        mergeUnsavedChanges(live, toSave)

        expect(live.chat).toEqual([['char-a', 'chat-0'], ['char-b', 'chat-2']])
    })
})

describe('sweepDraftRegistrations', () => {
    // Extracted from the save loop so that it can be tested alone (see this
    // function's own comment in `globalApi.svelte.ts`): the loop itself is a non-terminating
    // `while (true)` with heavy real side effects and cannot be driven by a
    // test. These tests can only prove `sweepDraftRegistrations` itself is
    // correct, not that `saveDb()`'s loop still calls it -- that call site is
    // not reachable from a test. Not something to fake with a check against
    // the loop's source text.
    //
    // Runs against the REAL `draftContentOrphanGate` (`src/ts/draftContentOrphanGate.ts`)
    // and REAL `localDrafts` (`src/ts/localDrafts.ts`) -- neither is mocked
    // above, and both are plain in-memory modules with nothing to fake.
    afterEach(() => {
        draftContentOrphanGate.clear()
        resetLocalDraftsForTest()
    })

    function msgIdentity(chatId: string): MessageIdentity {
        return { kind: 'msg', chatKey: 'chat-1', chatId, index: 0 }
    }

    test('releases an orphan registration once `now` is past its cap, without touching the record', () => {
        const identity = msgIdentity('chat-id-1')
        // Registered at an explicit, controlled `now` -- not real wall-clock
        // time -- so the threshold check below never depends on how long
        // this test actually takes to run.
        draftContentOrphanGate.set(identity, 'typed text', 'base text', 1_000)

        expect(hasLocalDrafts()).toBe(true)

        sweepDraftRegistrations(1_000 + DRAFT_CONTENT_ORPHAN_CAP_MS)

        // A function whose body is a no-op would never call through to the
        // real gate, so this would still be true.
        expect(hasLocalDrafts()).toBe(false)
        // Only the REGISTRATION is released -- the content record
        // itself must still be there, untouched.
        expect(draftContentOrphanGate.get(identity, 'base text')).toEqual({
            text: 'typed text',
            baseData: 'base text',
            updatedAt: expect.any(Number),
        })
    })

    test('does not release a registration before its cap has elapsed, and DOES use the given `now` rather than a hardcoded 0', () => {
        const identity = msgIdentity('chat-id-2')
        draftContentOrphanGate.set(identity, 'typed text', 'base text', 1_000)

        // One ms short of the cap -- still live.
        sweepDraftRegistrations(1_000 + DRAFT_CONTENT_ORPHAN_CAP_MS - 1)
        expect(hasLocalDrafts()).toBe(true)

        // A `now` hardcoded to 0 is always "before" a registration stamped
        // from a positive `now` (1_000 here), so it would never register as
        // expired -- this call, with a `now` genuinely past the cap, is what
        // a hardcoded-0 implementation would fail.
        sweepDraftRegistrations(1_000 + DRAFT_CONTENT_ORPHAN_CAP_MS)
        expect(hasLocalDrafts()).toBe(false)
    })
})
