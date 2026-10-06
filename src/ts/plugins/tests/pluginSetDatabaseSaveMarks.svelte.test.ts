/**
 * Report 17 ("CHORE-01 + Phase 2 item 2") Stage 1 §3.3/§3.4, S3:
 *
 * Real V2 plugin `setDatabase` / `setDatabaseLite` (`src/ts/plugins/plugins.svelte.ts`,
 * `getV2PluginAPIs()`), driven through the actual plugin-facing `getDatabase()`
 * Proxy wrapper those APIs return:
 *   (a) V2-style IN-PLACE edit of a non-selected character through the live
 *       wrapper -- persisted (red).
 *   (b) V3-style fresh array replacing `characters` wholesale -- persisted (red).
 *   (c) a character REMOVED from the array by the plugin still decodes on the
 *       next save (today's behaviour, kept) -- guard.
 *   (d) `characters: undefined` does not mark and does not throw -- guard (F9).
 *
 * Drives the REAL `getV2PluginAPIs()`, the REAL `characterSaveMarks.ts`, the
 * REAL `registerDbChangeEffects`, and the REAL `RisuSaveEncoder` (encode ->
 * decode round trip, per the plan's S3.4 table). Every other module
 * `plugins.svelte.ts` imports is mocked below purely so the module loads.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'

//#region module mocks

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn((db: Database) => {
        ;(globalThis as unknown as { __testDB: Database }).__testDB = db
        const state = (globalThis as unknown as { __testDBState: { db: Database } }).__testDBState
        state.db = db
    }),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertPluginConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    ;(globalThis as unknown as { __testDBState: { db: Database } }).__testDBState = state
    return {
        DBState: state,
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async () => true),
}) as unknown as typeof import('../pluginSafety'))

vi.mock(import('../pluginSafeClass'), () => ({
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
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock(import('../apiV3/v3.svelte'), () => ({
    loadV3Plugins: vi.fn(async () => {}),
}) as unknown as typeof import('../apiV3/v3.svelte'))

vi.mock(import('../apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../apiV3/transpiler'))

//#endregion

import { getV2PluginAPIs } from '../plugins.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../storage/characterSaveMarks'

//#region fixtures

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

function installDb(): void {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-0', 'char-1'],
        characters: [
            makeCharacter('char-0', 'Character Zero (selected)'),
            makeCharacter('char-1', 'Character One (not selected)'),
        ],
    } as unknown as Database
    DBState.db = db
    // Read DBState.db back AFTER assignment (Svelte re-proxies on assign), so
    // getDatabase() below returns the SAME live reactive proxy the rest of
    // this test (and the real production code) reads/writes through -- not a
    // stale reference to the pre-proxy plain object.
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

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

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

/** Wires the real effects + real marks, mirroring saveDb()'s setup. Returns a cleanup. */
async function wireRealSaveMachinery() {
    selectedCharID.set(0)
    const tracker = makeTracker()
    const markChanged = vi.fn()
    const cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged })
    })
    flushSync()
    installCharacterSaveMarks({ tracker, schedule: () => {} })

    const encoder = new RisuSaveEncoder()
    await encoder.init(snapshotDb(DBState.db), { compression: false })

    // Mirrors saveDb()'s post-init trim.
    tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

    return { tracker, encoder, cleanup }
}

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('V2 plugin setDatabase / setDatabaseLite', () => {
    test('(a) V2-style in-place edit of a non-selected character through the live wrapper is persisted', async () => {
        installDb()
        const { tracker, encoder, cleanup } = await wireRealSaveMachinery()

        const api = getV2PluginAPIs()
        // The plugin-facing getDatabase() return type is loosely typed
        // (untyped Proxy over the live db); cast to access `characters` the
        // same way a real plugin's untyped JS would.
        const pluginDb = api.getDatabase() as unknown as Database // the live Proxy wrapper
        // In-place edit through the wrapper -- 'characters' resolves to the
        // SAME live array (allowedDbKeys), so this mutates DBState.db.characters[1]
        // directly. No source reassignment happens here, matching the census
        // ("no source changes value, so no effect fires").
        pluginDb.characters[1].name = 'V2 in-place edited'
        api.setDatabaseLite(pluginDb)
        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        expect(toSave.character).toContain('char-1')

        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar1 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')
        expect(decodedChar1).toBeTruthy()
        expect(decodedChar1!.name).toBe('V2 in-place edited')

        cleanup()
    })

    test('(b) V3-style fresh characters array via setDatabase is persisted for every (non-selected) character', async () => {
        installDb()
        const { tracker, encoder, cleanup } = await wireRealSaveMachinery()

        const api = getV2PluginAPIs()
        const freshCharacters = [
            makeCharacter('char-0', 'Character Zero (selected, V3 fresh copy)'),
            makeCharacter('char-1', 'Character One (V3 fresh copy)'),
        ]
        await api.setDatabase({ characters: freshCharacters })
        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        expect(toSave.character).toContain('char-1')

        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar1 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')
        expect(decodedChar1).toBeTruthy()
        expect(decodedChar1!.name).toBe('Character One (V3 fresh copy)')

        cleanup()
    })

    test('(c) guard: a character removed from the array by the plugin still decodes on the next save (kept, never deleted)', async () => {
        installDb()
        const { tracker, encoder, cleanup } = await wireRealSaveMachinery()

        const api = getV2PluginAPIs()
        // Plugin's fresh snapshot no longer includes char-1 at all.
        await api.setDatabase({ characters: [makeCharacter('char-0', 'Character Zero (selected)')] })
        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        // char-1 was never marked (it's not in db.characters after the write,
        // so the new "mark every character" loop never sees it) -- matches
        // "never deletes" (plan §3.3).
        expect(toSave.character).not.toContain('char-1')

        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        // char-1's block still exists from init() and was never touched by
        // set() (not in toSave.character), so the decoder still reconstructs it.
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')).toBeTruthy()

        cleanup()
    })

    test('(d) guard: characters: undefined does not mark and does not throw (F9)', async () => {
        installDb()
        const { tracker, cleanup } = await wireRealSaveMachinery()

        const api = getV2PluginAPIs()
        const before = structuredClone(tracker) as toSaveType

        await expect(api.setDatabase({ temperature: 0.5 })).resolves.not.toThrow()
        flushSync()

        const after = structuredClone(tracker) as toSaveType
        expect(after.character).toEqual(before.character)

        cleanup()
    })
})

/**
 * A stale SECOND plugin setDatabase/setDatabaseLite call, made before any
 * save runs, must not resurrect a character the plugin's own reassignment
 * just removed. Both setters do `(db as any).characters = newDb.characters`
 * (an allowedDbKeys key) unconditionally -- call 2 supplying an older
 * `characters` array that's missing a character call 1 already marked is the
 * plugin genuinely removing it in memory, and that removal must be honoured:
 * `DBState.db.characters` must NOT contain the dropped id afterward.
 *
 * The actual fix lives at the SAVE level, not here: `prepareSaveIteration()`
 * (globalApi.svelte.ts) filters `toSave.character` down to ids present in
 * `opts.getDatabase().characters` whenever no reload happened this
 * iteration, so `RisuSaveEncoder.set()`'s delete branch can only ever run
 * through a reload -- see globalApi.saveSequence.svelte.test.ts's "no
 * reload: drops ids absent from db.characters" test for that guarantee. It
 * stays out of scope here on purpose (this file's mocks deliberately avoid
 * loading globalApi.svelte.ts for real, see the module-mock region above) --
 * these two tests assert only the plugin-level contract: the id may still
 * linger in the in-memory tracker (harmless; the save-level filter above
 * handles it), but the character object itself must be gone from
 * `db.characters`, not silently re-appended by the plugin setters.
 */
describe('stale second setDatabase/setDatabaseLite before any save', () => {
    test('setDatabase: char-1 marked by call 1, then a stale call 2 omits it -- the plugin\'s removal is honoured, char-1 is gone from db.characters', async () => {
        installDb()
        const { cleanup } = await wireRealSaveMachinery()

        const api = getV2PluginAPIs()

        // Call 1: marks both characters.
        await api.setDatabase({
            characters: [
                makeCharacter('char-0', 'Character Zero (v1)'),
                makeCharacter('char-1', 'Character One (v1)'),
            ],
        })
        flushSync()

        // Call 2: a SECOND, STALE call -- e.g. built from a snapshot the plugin
        // had cached before call 1 landed -- overwrites db.characters with an
        // array that no longer includes char-1 at all. This is the plugin
        // genuinely removing it in memory; it must not be re-added.
        await api.setDatabase({
            characters: [
                makeCharacter('char-0', 'Character Zero (v2, stale, missing char-1)'),
            ],
        })
        flushSync()

        // The plugin's removal is honoured: char-1 is gone from db.characters.
        // (The id may still linger in the in-memory tracker from call 1's
        // mark -- that's fine; it's the save-level filter, tested in
        // globalApi.saveSequence.svelte.test.ts, that keeps the encoder from
        // ever deleting a block for it without a reload.)
        expect(DBState.db.characters.find((c: CharacterFixture) => c.chaId === 'char-1')).toBeUndefined()

        cleanup()
    })

    test('setDatabaseLite: the same stale-second-call race -- the plugin\'s removal is honoured, char-1 is gone from db.characters', async () => {
        installDb()
        const { cleanup } = await wireRealSaveMachinery()

        const api = getV2PluginAPIs()

        api.setDatabaseLite({
            characters: [
                makeCharacter('char-0', 'Character Zero (v1)'),
                makeCharacter('char-1', 'Character One (v1)'),
            ],
        })
        flushSync()

        api.setDatabaseLite({
            characters: [
                makeCharacter('char-0', 'Character Zero (v2, stale, missing char-1)'),
            ],
        })
        flushSync()

        expect(DBState.db.characters.find((c: CharacterFixture) => c.chaId === 'char-1')).toBeUndefined()

        cleanup()
    })
})
