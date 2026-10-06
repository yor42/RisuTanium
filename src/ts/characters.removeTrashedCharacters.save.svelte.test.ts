/**
 * "Empty trash" (`removeTrashedCharacters`, src/ts/characters.ts) against the real save machinery.
 *
 * REAL and unmocked here: `characters.ts`, `globalApi.svelte.ts` (its `requiresFullEncoderReload`
 * flag, `prepareSaveIteration` and `checkCharOrder`), `characterSaveMarks.ts`, `risuSave.ts`
 * (`RisuSaveEncoder`, `decodeRisuSave`), `treeToBlockSet.ts` and `blockStore.ts` over the in-memory
 * store of `storage/tests/blockStoreHarness.ts`. The module-mock set is the one of
 * `globalApi.saveSequence.svelte.test.ts` plus what `characters.ts` itself imports. A mocked
 * success here is not evidence of native backend behaviour.
 *
 * The removal must (1) request one save burst, (2) set the reload flag so the save re-encodes
 * without the removed characters, and (3) end in one block-store commit that deletes exactly the
 * removed characters' block keys and keeps every other key, including the key a live twin shares
 * with a removed character. The committed layout is the one `prepareSaveIteration` and the
 * encoder produce, as the save loop commits it, so that commit depends on the reload flag.
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
import { prepareSaveIteration, requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { removeTrashedCharacters } from 'src/ts/characters'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { alertConfirm } from 'src/ts/alert'
import { treeToBlockSet } from 'src/ts/storage/treeToBlockSet'
import { packedForLayout } from 'src/ts/storage/saveStep'
import { characterBlockKey } from 'src/ts/storage/blockKeys'
import { createFakeStore, makeOwner, seedStore } from 'src/ts/storage/tests/blockStoreHarness'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const T0 = 1_700_000_000_000

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0,
        chats: [{ id: `${chaId}-chat-0-${name}`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: ['keepA', 'dup', 'keepB'],
        characters: [
            makeCharacter('keepA', 'KeepA'),
            makeCharacter('t1', 'Trash1', T0),
            makeCharacter('dup', 'LiveTwin'),
            makeCharacter('dup', 'TrashedTwin', T0),
            makeCharacter('t2', 'Trash2', T0),
            makeCharacter('keepB', 'KeepB'),
            makeCharacter('keepT', 'KeepTrashed', T0),
        ],
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: unknown }).__testDBState = DBState.db
    selectedCharID.set(-1)
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

const snapshot = () => $state.snapshot(DBState.db) as Database

/** Removes Trash1, TrashedTwin and Trash2 through the real function; KeepTrashed stays in the trash. */
async function emptySome(): Promise<void> {
    const refs = DBState.db.characters.filter((c) => ['Trash1', 'TrashedTwin', 'Trash2'].includes(c.name))
    expect(refs).toHaveLength(3)
    await removeTrashedCharacters(refs, { matching: true })
}

let tracker: toSaveType
let burstOpen = false
let requestsInBurst = 0
let requestsOutsideBurst = 0

beforeEach(() => {
    installDb()
    requiresFullEncoderReload.state = false
    vi.mocked(alertConfirm).mockClear()
    tracker = makeTracker()
    burstOpen = false
    requestsInBurst = 0
    requestsOutsideBurst = 0
    installCharacterSaveMarks({ tracker, schedule: () => {
        if (burstOpen) {
            requestsInBurst++
            return
        }
        if (requestsInBurst > 0) {
            requestsOutsideBurst++
            return
        }
        burstOpen = true
        requestsInBurst = 1
        queueMicrotask(() => { burstOpen = false })
    } })
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('E5: the removal against the real save machinery', () => {
    test('one save burst: every request happens in one synchronous stretch, and the real reload flag is set', async () => {
        const answered = vi.mocked(alertConfirm)
        await emptySome()
        expect(answered).toHaveBeenCalledTimes(1)
        expect(requiresFullEncoderReload.state).toBe(true)
        // Three removed ids: the first request opens the burst, the others land before any await.
        expect(requestsInBurst).toBe(3)
        expect(requestsOutsideBurst).toBe(0)
        expect(tracker.character).toEqual(['t1', 'dup', 't2'])
    })

    test('the next save iteration consumes the flag once, re-inits once, and an encode/decode round trip has the removed ids absent and the others present', async () => {
        const encoderBefore = new RisuSaveEncoder()
        await encoderBefore.init(snapshot(), { compression: false })
        const beforeDecoded = await decodeRisuSave(new Uint8Array(encoderBefore.encode()!))
        expect(beforeDecoded.characters?.map((c: CharacterFixture) => c.chaId).sort()).toEqual(['dup', 'keepA', 'keepB', 'keepT', 't1', 't2'])

        await emptySome()
        expect(requiresFullEncoderReload.state).toBe(true)

        let reinits = 0
        const result = await prepareSaveIteration({
            tracker,
            encoder: encoderBefore,
            reloadFlag: requiresFullEncoderReload,
            reinitEncoder: async () => {
                reinits++
                const fresh = new RisuSaveEncoder()
                await fresh.init(snapshot(), { compression: false })
                return fresh
            },
            getDatabase: () => snapshot(),
        })
        await result.encoder.set(snapshot(), result.toSave)

        expect(reinits).toBe(1)
        expect(requiresFullEncoderReload.state).toBe(false)
        const decoded = await decodeRisuSave(new Uint8Array(result.encoder.encode()!))
        const decodedIds = (decoded.characters ?? []).map((c: CharacterFixture) => c.chaId).sort()
        expect(decodedIds).toEqual(['dup', 'keepA', 'keepB', 'keepT'])
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'dup')?.name).toBe('LiveTwin')
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'keepT')?.trashTime).toBe(T0)
    })

    test('one block-store commit deletes exactly the removed characters\' block keys and keeps the others, including a live twin\'s key', async () => {
        const store = createFakeStore({ versioned: true })
        const generation = await seedStore(store, await treeToBlockSet(snapshot()))
        const { owner } = makeOwner(store)
        const loaded = await owner.load()
        expect(loaded.kind).toBe('loaded')
        for (const id of ['keepA', 'keepB', 'keepT', 't1', 't2', 'dup']) {
            expect(store.peek(characterBlockKey(generation, id))).not.toBeNull()
        }

        // The encoder a running save loop holds, initialised from the database before the removal.
        const encoderOptions = { compression: false }
        const loopEncoder = new RisuSaveEncoder()
        await loopEncoder.init(snapshot(), encoderOptions)

        await emptySome()
        const start = store.ops.length
        // The layout the save loop commits: whatever prepareSaveIteration hands back, so the
        // removed blocks leave it only because the removal set the reload flag.
        const iteration = await prepareSaveIteration({
            tracker,
            encoder: loopEncoder,
            reloadFlag: requiresFullEncoderReload,
            reinitEncoder: async () => {
                const fresh = new RisuSaveEncoder()
                await fresh.init(snapshot(), encoderOptions)
                return fresh
            },
            getDatabase: () => snapshot(),
        })
        await iteration.encoder.set(snapshot(), iteration.toSave)
        const layout = iteration.encoder.snapshotLayout()
        expect(layout).not.toBeNull()
        const result = await owner.commitSave({
            layout: layout!,
            packed: packedForLayout(layout!, snapshot().characters, iteration.encoder.getFrozenKeys()),
        })
        expect(result).toMatchObject({ kind: 'committed', wrote: true })

        const deletes = store.ops.slice(start).filter((op) => op.kind === 'deleteMany' || op.kind === 'delete')
        expect(deletes).toHaveLength(1)
        const deleted = deletes[0].kind === 'deleteMany' ? deletes[0].keys : [deletes[0].key]
        expect(new Set(deleted)).toEqual(new Set([characterBlockKey(generation, 't1'), characterBlockKey(generation, 't2')]))
        for (const id of ['keepA', 'keepB', 'keepT', 'dup']) {
            expect(store.peek(characterBlockKey(generation, id))).not.toBeNull()
        }
        for (const id of ['t1', 't2']) {
            expect(store.peek(characterBlockKey(generation, id))).toBeNull()
        }
    })
})
