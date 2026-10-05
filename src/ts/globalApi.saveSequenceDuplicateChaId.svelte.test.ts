/**
 * MC-078. A v2.1 plugin can duplicate a `chaId` entirely
 * in-place, through the live-proxy idiom (`api.getDatabase()`, mutated
 * directly, then `api.setDatabaseLite(api.getDatabase())`) -- W0's own
 * install-time duplicate warning never sees this route, because nothing ever
 * passes a fresh `characters` array through `setDatabaseLite`'s own
 * duplicate scan. The block already saved for char-0 is what the file keeps
 * regardless of where the in-place copy lands in the list; inserting it
 * ahead of the already-saved character below is what makes this fail
 * against a `set()` that simply overwrites the block from whichever holder
 * its linear scan reaches while the mark is still present.
 *
 * Drives the REAL `getV2PluginAPIs()` (`src/ts/plugins/plugins.svelte.ts`)
 * for the in-place duplicate, and the REAL `prepareSaveIteration`
 * (`src/ts/globalApi.svelte.ts`) for the marked save pass -- both load their
 * real, shared dependency graph, so this file's module-mock set is the union
 * of `globalApi.saveSequence.svelte.test.ts`'s (needed for the real
 * `globalApi.svelte.ts`) and `pluginIdentityFill.svelte.test.ts`'s (needed
 * for the real `plugins.svelte.ts`), not a trimmed subset of either.
 *
 * This file also drives the reload hand-over (`reloadSaveEncoder`) directly
 * from `prepareSaveIteration`'s own `reinitEncoder` callback, never a
 * reimplementation of it, so these assertions exercise the same path
 * production uses.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks -- union of globalApi.saveSequence.svelte.test.ts's and
// pluginIdentityFill.svelte.test.ts's own mock sets (see file header).

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
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: unknown }).__testDB),
    setDatabase: vi.fn((db: unknown) => {
        ;(globalThis as unknown as { __testDB: unknown }).__testDB = db
    }),
    setDatabaseLite: vi.fn(),
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
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
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
    alertPluginConfirm: vi.fn(async () => true),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
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

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
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

// plugins.svelte.ts's own additional dependencies (pluginIdentityFill.svelte.test.ts's set).

vi.mock(import('src/ts/plugins/pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/plugins/pluginSafety'))

vi.mock(import('src/ts/plugins/pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
}) as unknown as typeof import('src/ts/plugins/pluginSafeClass'))

vi.mock(import('src/ts/plugins/apiV3/v3.svelte'), () => ({
    loadV3Plugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/apiV3/v3.svelte'))

vi.mock(import('src/ts/plugins/apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('src/ts/plugins/apiV3/transpiler'))

//#endregion

import {
    prepareSaveIteration,
    reloadSaveEncoder,
    publishFrozenSaveIndicator,
    checkFrozenKeysForResolution,
} from 'src/ts/globalApi.svelte'
import { alertToast, alertNormal } from 'src/ts/alert'
import { frozenSaveKeysStore } from 'src/ts/stores.svelte'
import { get } from 'svelte/store'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import { resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { getV2PluginAPIs } from 'src/ts/plugins/plugins.svelte'
import { DBState } from 'src/ts/stores.svelte'

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

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

function snapshotDb(db: unknown): Database {
    return $state.snapshot(db as object) as Database
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    frozenSaveKeysStore.set([])
    ;(alertToast as ReturnType<typeof vi.fn>).mockClear()
    ;(alertNormal as ReturnType<typeof vi.fn>).mockClear()
})

//#endregion

describe('the v2.1 in-place duplicate route (MC-078)', () => {
    test('a marked set() pass after prepareSaveIteration keeps the block of the character already saved, not an in-place copy inserted ahead of it', async () => {
        DBState.db = buildDb([
            makeCharacter('char-0', 'Character Zero'),
            makeCharacter('char-1', 'Character One'),
        ])
        ;(globalThis as unknown as { __testDB: unknown }).__testDB = DBState.db

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false, skipRemoteSavingOnCharacters: false })

        // The v2.1 live-proxy idiom: a plugin reads getDatabase(), mutates the
        // live array in place (inserting a copy of char-0 sharing its chaId,
        // ahead of the original), then calls setDatabaseLite(getDatabase())
        // with that SAME live reference -- the route W0's install-time
        // duplicate warning never sees, because no fresh incoming array is
        // ever compared against a prior baseline.
        const api = getV2PluginAPIs()
        const liveDb = api.getDatabase() as unknown as Database
        liveDb.characters.unshift(makeCharacter('char-0', 'Character Zero (in-place copy)'))
        api.setDatabaseLite(api.getDatabase())

        const tracker = makeTracker()
        tracker.character = ['char-0']
        const reloadFlag = { state: false }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => { throw new Error('must not reload') },
            getDatabase: () => DBState.db as unknown as Database,
        })

        await result.encoder.set(snapshotDb(DBState.db), result.toSave)
        const decoded = await decodeRisuSave(new Uint8Array(result.encoder.encode()!))
        const savedChar0 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-0')

        // The block kept is the one already saved before the copy existed,
        // not the in-place copy that landed ahead of it in list order.
        expect(savedChar0?.name).toBe('Character Zero')
    })
})

// MC-078, MC-079, MC-082: a full reload must keep a block the guard already
// kept, by carrying it from the encoder being replaced. Driven through
// prepareSaveIteration with reinitEncoder wired to the real, exported
// reloadSaveEncoder -- never a private reimplementation of it -- so these
// assertions exercise the same path production uses.
describe('a full reload keeps the block a duplicated chaId already had', () => {
    test('an edit made just before the reload, with a copy already inserted, is not what the file keeps', async () => {
        const chaId = 'dup-9'
        const original = makeCharacter(chaId, 'Original')
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        // An ordinary save happens before the duplicate appears.
        const editedOnce = makeCharacter(chaId, 'Original (edited once)')
        const firstMark = makeTracker()
        firstMark.character = [chaId]
        await encoder.set(buildDb([editedOnce]), firstMark)

        // A copy now shares the key, and the original is edited again --
        // this reload must keep the content from the LAST COMPLETED pass,
        // not this in-flight edit and not the copy.
        const copy = makeCharacter(chaId, 'Copy')
        const editedTwice = makeCharacter(chaId, 'Original (edited twice)')
        const db = buildDb([copy, editedTwice])

        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => reloadSaveEncoder(encoder, db, { compression: false }),
            getDatabase: () => db,
        })
        encoder = result.encoder
        await encoder.set(db, result.toSave)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original (edited once)')
    })

    test('a reload straight from boot, with no set() pass in between, keeps boot\'s own content', async () => {
        const chaId = 'dup-9b'
        const original = makeCharacter(chaId, 'Original')
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const editedOriginal = makeCharacter(chaId, 'Original (edited)')
        const db = buildDb([copy, editedOriginal])

        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => reloadSaveEncoder(encoder, db, { compression: false }),
            getDatabase: () => db,
        })
        encoder = result.encoder
        await encoder.set(db, result.toSave)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original')
    })

    test('a reload with no prior block anywhere writes only the first holder in snapshot order', async () => {
        const chaId = 'dup-10'
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([]))

        const first = makeCharacter(chaId, 'First')
        const second = makeCharacter(chaId, 'Second')
        const db = buildDb([first, second])

        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => reloadSaveEncoder(encoder, db, { compression: false }),
            getDatabase: () => db,
        })
        encoder = result.encoder
        await encoder.set(db, result.toSave)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('First')
    })

    test('a duplicate resolved after the reload is written, with its current content, by the next pass', async () => {
        const chaId = 'dup-11'
        const original = makeCharacter(chaId, 'Original')
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const characters = [copy, original]
        const db = buildDb(characters)

        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => reloadSaveEncoder(encoder, db, { compression: false }),
            getDatabase: () => db,
        })
        encoder = result.encoder
        expect(encoder.getFrozenKeys().has(chaId)).toBe(true)

        // The copy is permanently deleted, with no save mark of its own, and
        // the survivor was edited while frozen -- so a skipped write is
        // distinguishable from a write of stale, pre-freeze content.
        const editedSurvivor = makeCharacter(chaId, 'Original (edited while frozen)')
        const dbAfter = buildDb([editedSurvivor])
        await encoder.set(dbAfter, makeTracker())

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original (edited while frozen)')
        expect(encoder.getFrozenKeys().has(chaId)).toBe(false)
    })

    test('after a reload, the surviving holder\'s edits made while frozen are written once the duplicate is permanently resolved', async () => {
        const chaId = 'dup-12a'
        const original = makeCharacter(chaId, 'Original')
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const editedWhileFrozen = makeCharacter(chaId, 'Original (edited while frozen)')
        let db = buildDb([copy, editedWhileFrozen])

        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => reloadSaveEncoder(encoder, db, { compression: false }),
            getDatabase: () => db,
        })
        encoder = result.encoder
        await encoder.set(db, result.toSave)
        // Still frozen right after the reload: the pre-edit content is kept.
        expect((await decodeRisuSave(new Uint8Array(encoder.encode()!))).characters
            ?.find((c: CharacterFixture) => c.chaId === chaId)?.name).toBe('Original')

        // The copy is permanently deleted.
        db = buildDb([editedWhileFrozen])
        await encoder.set(db, makeTracker())

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original (edited while frozen)')
    })

    test('when both holders of a reload-frozen key are removed and marked, the block is deleted, the same as removing any other character', async () => {
        const chaId = 'dup-12both'
        const original = makeCharacter(chaId, 'Original')
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        let db = buildDb([copy, original])

        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => reloadSaveEncoder(encoder, db, { compression: false }),
            getDatabase: () => db,
        })
        encoder = result.encoder
        await encoder.set(db, result.toSave)

        // Both holders are gone, and the id is marked -- mirrors removeChar's
        // permanent-delete path.
        db = buildDb([])
        const toSave = makeTracker()
        toSave.character = [chaId]
        await encoder.set(db, toSave)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)).toBeUndefined()
    })

    test('a key frozen by a previous encoder does not come back once both its holders are gone by the next reload', async () => {
        const chaId = 'dup-12b'
        const original = makeCharacter(chaId, 'Original')
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        let db = buildDb([copy, original])
        await encoder.set(db, makeTracker())
        expect(encoder.getFrozenKeys().has(chaId)).toBe(true)

        // Both holders are gone entirely by the time the reload runs.
        db = buildDb([])
        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => reloadSaveEncoder(encoder, db, { compression: false }),
            getDatabase: () => db,
        })
        encoder = result.encoder

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)).toBeUndefined()
    })
})

// A frozen key with fewer than two holders leaves the frozen set that same
// pass, whether it drops to one holder or to zero (MC-078, MC-079, MC-082).
describe('a frozen key leaves the frozen set on its own once its holder count drops below two', () => {
    test('zero holders: the key leaves the frozen set, the indicator clears, and the idle step asks for exactly one more save', async () => {
        const chaId = 'dup-13'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        await encoder.set(buildDb([copy, original]), makeTracker())
        expect(encoder.getFrozenKeys().has(chaId)).toBe(true)

        // Both holders are spliced out, with no mark and no reload.
        const db = buildDb([])
        expect(checkFrozenKeysForResolution(encoder, db)).toBe(true)

        await encoder.set(db, makeTracker())
        expect(encoder.getFrozenKeys().has(chaId)).toBe(false)

        publishFrozenSaveIndicator(encoder, db)
        expect(get(frozenSaveKeysStore)).toEqual([])

        expect(checkFrozenKeysForResolution(encoder, db)).toBe(false)
    })

    test('one holder: the idle step asks for a save, and that save writes the survivor\'s current, edited content', async () => {
        const chaId = 'dup-14'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        await encoder.set(buildDb([copy, original]), makeTracker())
        expect(encoder.getFrozenKeys().has(chaId)).toBe(true)

        // The copy is permanently deleted, with no save mark of its own, and
        // the survivor was edited while frozen -- so a skipped write is
        // distinguishable from a write of stale, pre-freeze content.
        const editedOriginal = makeCharacter(chaId, 'Original (edited while frozen)')
        const db = buildDb([editedOriginal])
        expect(checkFrozenKeysForResolution(encoder, db)).toBe(true)

        await encoder.set(db, makeTracker())
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)?.name).toBe('Original (edited while frozen)')
        expect(checkFrozenKeysForResolution(encoder, db)).toBe(false)
    })
})

// The indicator and the console warning fire for every route that can
// freeze a key (set(), boot's init(), and a reload's carry), the warning
// fires once per episode and re-arms once the key resolves, and nothing on
// this path ever writes to the alert store (MC-078, MC-079, MC-082).
describe('the frozen-key indicator and warning', () => {
    test('publishFrozenSaveIndicator publishes the keys set() has frozen, warns once, and does not re-publish or re-warn on an unchanged pass', async () => {
        const chaId = 'dup-16-set'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const copy = makeCharacter(chaId, 'Copy')
            const db = buildDb([copy, original])
            const toSave = makeTracker()
            toSave.character = [chaId]
            await encoder.set(db, toSave)
            publishFrozenSaveIndicator(encoder, db)

            const entries = get(frozenSaveKeysStore)
            expect(entries.length).toBe(1)
            expect(entries[0].chaId).toBe(chaId)
            expect(new Set(entries[0].names)).toEqual(new Set(['Original', 'Copy']))

            const warningsForKey = () => warnSpy.mock.calls.filter((args) =>
                args.some((a) => typeof a === 'string' && a.includes(chaId)))
            expect(warningsForKey().length).toBe(1)

            const setSpy = vi.spyOn(frozenSaveKeysStore, 'set')
            try {
                publishFrozenSaveIndicator(encoder, db)
                expect(setSpy).not.toHaveBeenCalled()
                expect(warningsForKey().length).toBe(1)
            } finally {
                setSpy.mockRestore()
            }

            expect(alertToast).not.toHaveBeenCalled()
            expect(alertNormal).not.toHaveBeenCalled()
        } finally {
            warnSpy.mockRestore()
        }
    })

    test('publishFrozenSaveIndicator publishes the keys a boot init() pass has frozen', async () => {
        const chaId = 'dup-16-init'
        const first = makeCharacter(chaId, 'First')
        const second = makeCharacter(chaId, 'Second')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([first, second]))

        publishFrozenSaveIndicator(encoder, buildDb([first, second]))
        expect(get(frozenSaveKeysStore).some((e) => e.chaId === chaId)).toBe(true)
    })

    // Mirrors the shape of saveDb()'s own reinitEncoder closure (reloadSaveEncoder,
    // then publishFrozenSaveIndicator) so the encoder publishFrozenSaveIndicator
    // is called on here is the one an actual reload would carry -- it does not
    // drive saveDb()'s own loop, retry, or try/catch wrapping.
    test('publishFrozenSaveIndicator publishes the keys a reload\'s carried encoder has frozen', async () => {
        const chaId = 'dup-16-reload'
        const original = makeCharacter(chaId, 'Original')
        let encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const db = buildDb([copy, original])
        const tracker = makeTracker()
        const reloadFlag = { state: true }
        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder: async () => {
                const fresh = await reloadSaveEncoder(encoder, db, { compression: false })
                publishFrozenSaveIndicator(fresh, db)
                return fresh
            },
            getDatabase: () => db,
        })
        encoder = result.encoder

        expect(get(frozenSaveKeysStore).some((e) => e.chaId === chaId)).toBe(true)
    })

    test('the warning re-arms once a key resolves and fires again for a fresh duplicate on the same chaId', async () => {
        const chaId = 'dup-16-rearm'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const warningsForKey = () => warnSpy.mock.calls.filter((args) =>
                args.some((a) => typeof a === 'string' && a.includes(chaId)))

            const copy = makeCharacter(chaId, 'Copy')
            const toSave1 = makeTracker()
            toSave1.character = [chaId]
            await encoder.set(buildDb([copy, original]), toSave1)
            publishFrozenSaveIndicator(encoder, buildDb([copy, original]))
            expect(warningsForKey().length).toBe(1)

            // Resolves.
            await encoder.set(buildDb([original]), makeTracker())
            publishFrozenSaveIndicator(encoder, buildDb([original]))
            expect(get(frozenSaveKeysStore)).toEqual([])

            // A fresh duplicate on the same chaId warns again.
            const copy2 = makeCharacter(chaId, 'Copy2')
            const toSave2 = makeTracker()
            toSave2.character = [chaId]
            await encoder.set(buildDb([copy2, original]), toSave2)
            publishFrozenSaveIndicator(encoder, buildDb([copy2, original]))
            expect(warningsForKey().length).toBe(2)
        } finally {
            warnSpy.mockRestore()
        }
    })
})
