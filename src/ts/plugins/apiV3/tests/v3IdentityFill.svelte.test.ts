/**
 * The real V3 install routes (`setChatToIndexImpl`, `setCharacterToIndex`,
 * and `setChar`/`setCharacter` shared with v2.1) fill a missing chat id or
 * `chaId` with a fresh id -- never inherited from the object being replaced,
 * because deciding which side of a multi-call swap or rotation an id-less
 * object stands for cannot be decided one call at a time -- never move or
 * reassign an id already present, and warn (naming the plugin) when the
 * incoming value counts an id twice or more where the baseline just before
 * the call did not. That is a noise filter; the warning reports the state
 * after the call, not blame. Driven through the real `makeRisuaiAPIV3` so
 * the warning tests below reach a real plugin name.
 *
 * `plugins.svelte.ts` is loaded for real here (not stubbed), because
 * `setChar`/`setCharacter` live in its `getV2PluginAPIs()` and this file
 * needs their real behaviour. Its own dependency graph is mocked below,
 * merged with `v3.svelte.ts`'s (copied, unchanged in shape, from
 * `pluginSetDatabaseSaveMarks.svelte.test.ts` and `v3SaveMarks.svelte.test.ts`
 * respectively) so both real modules can load side by side -- they already
 * reference each other in production (`v3.svelte.ts` imports
 * `getV2PluginAPIs` from `plugins.svelte.ts`, which imports `loadV3Plugins`
 * back from `v3.svelte.ts`), and neither uses the other's export at
 * module-init time, so the real circular pair loads the same way it does in
 * the app.
 */
import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'

//#region module mocks -- merged from pluginSetDatabaseSaveMarks.svelte.test.ts
// (src/ts/plugins/tests/) and v3SaveMarks.svelte.test.ts (this directory),
// since this file loads the real `plugins.svelte.ts` AND the real
// `v3.svelte.ts` together.

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

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn((db: Database) => {
        ;(globalThis as unknown as { __testDB: Database }).__testDB = db
        const state = (globalThis as unknown as { __testDBState: { db: Database } }).__testDBState
        state.db = db
    }),
    setDatabaseLite: vi.fn((db: Database) => {
        ;(globalThis as unknown as { __testDB: Database }).__testDB = db
        const state = (globalThis as unknown as { __testDBState: { db: Database } }).__testDBState
        state.db = db
    }),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../../storage/database.svelte'))

vi.mock(import('../../pluginSafeClass'), () => ({
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
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock(import('../../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async () => true),
}) as unknown as typeof import('../../pluginSafety'))

vi.mock(import('../transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../transpiler'))

vi.mock(import('../../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    ;(globalThis as unknown as { __testDBState: { db: Database } }).__testDBState = state
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    sleep: vi.fn(async () => {}),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertPluginConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFetchLogs: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
}) as unknown as typeof import('../../../globalApi.svelte'))

vi.mock(import('../../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../../gui/colorscheme'))

vi.mock(import('../../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
}) as unknown as typeof import('../../../platform'))

vi.mock(import('../../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../../process/mcp/pluginmcp'))

vi.mock(import('../../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: vi.fn(async () => 'hash'),
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../../parser/parser.svelte'))

vi.mock(import('../../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../../model/types'))

vi.mock(import('../../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../../process/index.svelte'))

vi.mock(import('../../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../../process/scripts'))

vi.mock(import('../../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../../model/modellist'))

vi.mock(import('../../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../../process/request/request'))

vi.mock(import('../../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../../process/modules'))

vi.mock(import('../../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../../process/ttsHooks'))

//#endregion

import { makeRisuaiAPIV3, setChatToIndexImpl } from '../v3.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../../storage/risuSave'
import { repairDatabaseIds } from '../../../process/chatIds'
import * as chatIdsModule from '../../../process/chatIds'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type ChatFixture = CharacterFixture['chats'][number]

function makeChat(id: string | undefined, name: string): ChatFixture {
    return {
        id,
        message: [{ role: 'user', data: name, time: 1 }],
        note: '',
        name,
        localLore: [],
    } as unknown as ChatFixture
}

function makeCharacter(chaId: string | undefined, name: string, chats?: ChatFixture[]): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: chats ?? [makeChat(`${chaId}-chat-0`, `${name} chat 0`)],
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: 'test-plugin', script: '' }],
        pluginCustomStorage: {},
        characterOrder: ['char-0', 'char-1'],
        characters: [
            makeCharacter('char-0', 'Character Zero', [
                makeChat('char-0-chat-0', 'Char0 chat0'),
                makeChat('char-0-chat-1', 'Char0 chat1'),
            ]),
            makeCharacter('char-1', 'Character One'),
        ],
    } as unknown as Database
    // The mocked `storage/database.svelte` reads/writes this global directly
    // (see the module mock above), mirroring pluginSetDatabaseSaveMarks's
    // harness -- read back AFTER assignment so it is the same live reactive
    // proxy the rest of this test (and the real production code) uses.
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

function makeApi(pluginName = 'test-plugin') {
    return makeRisuaiAPIV3({} as HTMLIFrameElement, { name: pluginName } as never)
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

//#endregion

describe('setChatToIndexImpl never inherits the replaced chat\'s id', () => {
    test('an id-less replacement chat gets a fresh id, never the replaced chat\'s', () => {
        installDb()
        const originalId = DBState.db.characters[0].chats[0].id
        const replacement = makeChat(undefined, 'replacement')
        setChatToIndexImpl(0, 0, replacement)
        expect(DBState.db.characters[0].chats[0].id).not.toBe(originalId)
        expect(typeof DBState.db.characters[0].chats[0].id).toBe('string')
        expect((DBState.db.characters[0].chats[0].id as string).length).toBeGreaterThan(0)
    })

    // Coverage, not proof: an implementation that never touched a present id
    // at all would also satisfy this, so passing here does not by itself
    // prove the fill's own guard runs.
    test('a replacement chat that already carries an id keeps it', () => {
        installDb()
        const replacement = makeChat('plugin-supplied-id', 'replacement')
        setChatToIndexImpl(0, 0, replacement)
        expect(DBState.db.characters[0].chats[0].id).toBe('plugin-supplied-id')
    })

    test('when the chat being replaced has no id itself, an id-less replacement gets a fresh id', () => {
        installDb()
        // The chat "already in the database" at this slot has no id of its own.
        DBState.db.characters[0].chats[0] = makeChat(undefined, 'id-less original')
        const replacement = makeChat(undefined, 'replacement')
        setChatToIndexImpl(0, 0, replacement)
        expect(typeof DBState.db.characters[0].chats[0].id).toBe('string')
        expect((DBState.db.characters[0].chats[0].id as string).length).toBeGreaterThan(0)
    })
})

describe('installing a character with an id-less unshifted chat, via setCharacterToIndex and via setChar', () => {
    function runVariant(install: (char: CharacterFixture) => void) {
        installDb()
        const api = makeApi()
        const snapshot = api.getCharacterFromIndex(0) as CharacterFixture
        const existingIds = snapshot.chats.map(c => c.id)
        snapshot.chats.unshift(makeChat(undefined, 'unshifted copy'))

        install(snapshot)

        const installedChats = DBState.db.characters[0].chats
        expect(typeof installedChats[0].id).toBe('string')
        expect((installedChats[0].id as string).length).toBeGreaterThan(0)
        for (let i = 0; i < existingIds.length; i++) {
            expect(installedChats[i + 1].id).toBe(existingIds[i])
        }
        const ids = installedChats.map(c => c.id)
        expect(new Set(ids).size).toBe(ids.length)
    }

    test('via setCharacterToIndex', () => {
        const api = makeApi()
        runVariant((char) => api.setCharacterToIndex(0, char))
    })

    test('via setChar', () => {
        selectedCharID.set(0)
        const api = makeApi()
        runVariant((char) => api.setChar(char))
    })
})

describe('setCharacterToIndex and setChar never inherit the replaced character\'s chaId', () => {
    test('via setCharacterToIndex: the installed character gets a fresh chaId, never the replaced one\'s', () => {
        installDb()
        const api = makeApi()
        const originalChaId = DBState.db.characters[1].chaId
        const replacement = makeCharacter(undefined, 'Replacement')
        api.setCharacterToIndex(1, replacement)
        expect(DBState.db.characters[1].chaId).not.toBe(originalChaId)
        expect(typeof DBState.db.characters[1].chaId).toBe('string')
        expect((DBState.db.characters[1].chaId as string).length).toBeGreaterThan(0)
    })

    test('via setChar: the installed character gets a fresh chaId, never the replaced one\'s', () => {
        installDb()
        selectedCharID.set(1)
        const api = makeApi()
        const originalChaId = DBState.db.characters[1].chaId
        const replacement = makeCharacter(undefined, 'Replacement')
        api.setChar(replacement)
        expect(DBState.db.characters[1].chaId).not.toBe(originalChaId)
        expect(typeof DBState.db.characters[1].chaId).toBe('string')
        expect((DBState.db.characters[1].chaId as string).length).toBeGreaterThan(0)
    })

    test('setChar with nothing selected gives the installed character a fresh chaId', () => {
        installDb()
        selectedCharID.set(-1)
        const api = makeApi()
        const replacement = makeCharacter(undefined, 'Replacement')
        api.setChar(replacement)
        // The write target for a call made with nothing selected is
        // pre-existing behaviour (a separate, already-tracked chore) and is
        // not asserted here -- only that the object the plugin passed in
        // ends up with a fresh chaId.
        expect(typeof replacement.chaId).toBe('string')
        expect((replacement.chaId as string).length).toBeGreaterThan(0)
    })
})

describe('a character swap between an id-less side and a chaId-bearing side never leaves a duplicate chaId, in either installation order', () => {
    function makeXAndK(): void {
        installDb()
        DBState.db.characters = [
            makeCharacter(undefined, 'X'),
            makeCharacter('char-1', 'K'),
        ] as unknown as Database['characters']
    }

    test('chaId-bearing side installed first: neither slot duplicates a chaId, and the id-less side gets a fresh one', () => {
        makeXAndK()
        const api = makeApi()
        const xClone = api.getCharacterFromIndex(0) as CharacterFixture
        const kClone = api.getCharacterFromIndex(1) as CharacterFixture

        api.setCharacterToIndex(0, kClone)
        api.setCharacterToIndex(1, xClone)

        const chaIds = DBState.db.characters.map((c) => c.chaId)
        expect(new Set(chaIds).size).toBe(chaIds.length)
        expect(DBState.db.characters[0].chaId).toBe('char-1')
        expect(DBState.db.characters[1].chaId).not.toBe('char-1')
        expect(typeof DBState.db.characters[1].chaId).toBe('string')
        expect((DBState.db.characters[1].chaId as string).length).toBeGreaterThan(0)
    })

    // A missing chaId is always fresh, so no installation order can hand an
    // existing chaId to a second holder.
    test('id-less side installed first: neither slot duplicates a chaId, and the id-less side gets a fresh one', () => {
        makeXAndK()
        const api = makeApi()
        const xClone = api.getCharacterFromIndex(0) as CharacterFixture
        const kClone = api.getCharacterFromIndex(1) as CharacterFixture

        api.setCharacterToIndex(1, xClone)
        api.setCharacterToIndex(0, kClone)

        const chaIds = DBState.db.characters.map((c) => c.chaId)
        expect(new Set(chaIds).size).toBe(chaIds.length)
        expect(DBState.db.characters[0].chaId).toBe('char-1')
        expect(DBState.db.characters[1].chaId).not.toBe('char-1')
        expect(typeof DBState.db.characters[1].chaId).toBe('string')
        expect((DBState.db.characters[1].chaId as string).length).toBeGreaterThan(0)
    })

    // Coverage, not proof: an install that never fills a missing chaId at
    // all leaves the id-less side's chaId as undefined, which is still
    // distinct from the other side's real chaId, so the count and
    // distinctness checks below pass without any fill ever running.
    test('chaId-bearing side installed first: both characters survive a full encode and decode', async () => {
        makeXAndK()
        const api = makeApi()
        const xClone = api.getCharacterFromIndex(0) as CharacterFixture
        const kClone = api.getCharacterFromIndex(1) as CharacterFixture

        api.setCharacterToIndex(0, kClone)
        api.setCharacterToIndex(1, xClone)

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        expect(decoded.characters.length).toBe(2)
        expect(new Set(decoded.characters.map((c: CharacterFixture) => c.chaId)).size).toBe(2)
    })

    // Coverage, not proof: guards against inheritance being introduced, the
    // same reasoning as the chaId-bearing-first variant above -- an
    // unfilled id-less chaId stays undefined, still distinct from
    // 'char-1', so this passes without any fill ever running.
    test('id-less side installed first: both characters survive a full encode and decode', async () => {
        makeXAndK()
        const api = makeApi()
        const xClone = api.getCharacterFromIndex(0) as CharacterFixture
        const kClone = api.getCharacterFromIndex(1) as CharacterFixture

        api.setCharacterToIndex(1, xClone)
        api.setCharacterToIndex(0, kClone)

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        expect(decoded.characters.length).toBe(2)
        expect(new Set(decoded.characters.map((c: CharacterFixture) => c.chaId)).size).toBe(2)
    })

    // Coverage, not proof: same reasoning as the encode/decode test above --
    // an unfilled id-less chaId is undefined, which is still distinct from
    // 'char-1', so this passes without any fill ever running.
    test('via setChar under a changing selection, chaId-bearing side installed first: neither slot duplicates a chaId', () => {
        makeXAndK()
        const api = makeApi()
        const kSnapshot = { ...DBState.db.characters[1] } as CharacterFixture
        const xSnapshot = { ...DBState.db.characters[0] } as CharacterFixture

        selectedCharID.set(0)
        api.setChar(kSnapshot)
        selectedCharID.set(1)
        api.setChar(xSnapshot)

        const chaIds = DBState.db.characters.map((c) => c.chaId)
        expect(new Set(chaIds).size).toBe(chaIds.length)
        expect(DBState.db.characters[0].chaId).toBe('char-1')
        expect(DBState.db.characters[1].chaId).not.toBe('char-1')
    })

    // Coverage, not proof: guards against inheritance being introduced, the
    // same reasoning as the chaId-bearing-first variant above -- an
    // unfilled id-less chaId stays undefined, still distinct from
    // 'char-1', so this passes without any fill ever running.
    test('via setChar under a changing selection, id-less side installed first: neither slot duplicates a chaId', () => {
        makeXAndK()
        const api = makeApi()
        const kSnapshot = { ...DBState.db.characters[1] } as CharacterFixture
        const xSnapshot = { ...DBState.db.characters[0] } as CharacterFixture

        selectedCharID.set(1)
        api.setChar(xSnapshot)
        selectedCharID.set(0)
        api.setChar(kSnapshot)

        const chaIds = DBState.db.characters.map((c) => c.chaId)
        expect(new Set(chaIds).size).toBe(chaIds.length)
        expect(DBState.db.characters[0].chaId).toBe('char-1')
        expect(DBState.db.characters[1].chaId).not.toBe('char-1')
    })
})

describe('a three-way character rotation with one id-less member never leaves a duplicate chaId', () => {
    // A missing chaId is always fresh, so no ordering of a rotation can hand
    // an existing chaId to a second holder.
    test('[X(no chaId), K, J] installed to [J, X, K] in slot order: every chaId is distinct, and every character survives a full encode and decode', async () => {
        installDb()
        DBState.db.characters = [
            makeCharacter(undefined, 'X'),
            makeCharacter('char-1', 'K'),
            makeCharacter('char-2', 'J'),
        ] as unknown as Database['characters']
        const api = makeApi()
        const xClone = api.getCharacterFromIndex(0) as CharacterFixture
        const kClone = api.getCharacterFromIndex(1) as CharacterFixture
        const jClone = api.getCharacterFromIndex(2) as CharacterFixture

        api.setCharacterToIndex(0, jClone)
        api.setCharacterToIndex(1, xClone)
        api.setCharacterToIndex(2, kClone)

        const chaIds = DBState.db.characters.map((c) => c.chaId)
        expect(new Set(chaIds).size).toBe(3)
        expect(DBState.db.characters[0].chaId).toBe('char-2')
        expect(DBState.db.characters[2].chaId).toBe('char-1')
        expect(typeof DBState.db.characters[1].chaId).toBe('string')
        expect((DBState.db.characters[1].chaId as string).length).toBeGreaterThan(0)

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(decoded.characters.length).toBe(3)
        expect(new Set(decoded.characters.map((c: CharacterFixture) => c.chaId)).size).toBe(3)
    })
})

describe('a chat swap between an id-less side and an id-bearing side never leaves a duplicate chat id, in either installation order', () => {
    function makeXAndK1(): void {
        installDb()
        DBState.db.characters[0].chats = [
            makeChat(undefined, 'x'),
            makeChat('k1', 'k'),
        ] as unknown as CharacterFixture['chats']
    }

    // Coverage, not proof: an unfilled id-less chat's id stays undefined,
    // which is still distinct from 'k1', so this passes without any fill
    // ever running.
    test('id-bearing side installed first: neither chat duplicates an id', () => {
        makeXAndK1()
        const xClone = { ...DBState.db.characters[0].chats[0] }
        const kClone = { ...DBState.db.characters[0].chats[1] }

        setChatToIndexImpl(0, 0, kClone)
        setChatToIndexImpl(0, 1, xClone)

        const ids = DBState.db.characters[0].chats.map((c) => c.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(DBState.db.characters[0].chats[0].id).toBe('k1')
        expect(DBState.db.characters[0].chats[1].id).not.toBe('k1')
    })

    // A missing chat id is always fresh, so no installation order can hand
    // an existing id to a second holder within one owner.
    //
    // Coverage, not proof: guards against inheritance being introduced -- an
    // unfilled id-less chat's id stays undefined, still distinct from 'k1',
    // so this passes without any fill ever running.
    test('id-less side installed first: neither chat duplicates an id', () => {
        makeXAndK1()
        const xClone = { ...DBState.db.characters[0].chats[0] }
        const kClone = { ...DBState.db.characters[0].chats[1] }

        setChatToIndexImpl(0, 1, xClone)
        setChatToIndexImpl(0, 0, kClone)

        const ids = DBState.db.characters[0].chats.map((c) => c.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(DBState.db.characters[0].chats[0].id).toBe('k1')
        expect(DBState.db.characters[0].chats[1].id).not.toBe('k1')
    })
})

describe('a three-way chat rotation with one id-less member never leaves a duplicate chat id', () => {
    test('[X(no id), K, J] installed to [J, X, K] in slot order: every id is distinct', () => {
        installDb()
        DBState.db.characters[0].chats = [
            makeChat(undefined, 'x'),
            makeChat('k1', 'k'),
            makeChat('j1', 'j'),
        ] as unknown as CharacterFixture['chats']
        const xClone = { ...DBState.db.characters[0].chats[0] }
        const kClone = { ...DBState.db.characters[0].chats[1] }
        const jClone = { ...DBState.db.characters[0].chats[2] }

        setChatToIndexImpl(0, 0, jClone)
        setChatToIndexImpl(0, 1, xClone)
        setChatToIndexImpl(0, 2, kClone)

        const ids = DBState.db.characters[0].chats.map((c) => c.id)
        expect(new Set(ids).size).toBe(3)
        expect(DBState.db.characters[0].chats[0].id).toBe('j1')
        expect(DBState.db.characters[0].chats[2].id).toBe('k1')
        expect(typeof DBState.db.characters[0].chats[1].id).toBe('string')
        expect((DBState.db.characters[0].chats[1].id as string).length).toBeGreaterThan(0)
    })
})

describe('installing a character or chat fills its id before installing it into the live array', () => {
    test('setChatToIndexImpl fills before installing the chat', () => {
        installDb()
        const replaced = DBState.db.characters[0].chats[0]
        const replacement = makeChat(undefined, 'replacement')
        let liveSlotAtFillTime: unknown
        const original = chatIdsModule.fillMissingChatSlotId
        const spy = vi.spyOn(chatIdsModule, 'fillMissingChatSlotId').mockImplementation((...args) => {
            liveSlotAtFillTime = DBState.db.characters[0].chats[0]
            return original(...args)
        })

        setChatToIndexImpl(0, 0, replacement)

        spy.mockRestore()
        expect(liveSlotAtFillTime).toBe(replaced)
        expect(liveSlotAtFillTime).not.toBe(replacement)
    })

    test('setCharacterToIndex fills before installing the character', () => {
        installDb()
        const api = makeApi()
        const replaced = DBState.db.characters[1]
        const replacement = makeCharacter(undefined, 'Replacement')
        let liveSlotAtFillTime: unknown
        const original = chatIdsModule.fillMissingCharacterInstallIds
        const spy = vi.spyOn(chatIdsModule, 'fillMissingCharacterInstallIds').mockImplementation((...args) => {
            liveSlotAtFillTime = DBState.db.characters[1]
            return original(...args)
        })

        api.setCharacterToIndex(1, replacement)

        spy.mockRestore()
        expect(liveSlotAtFillTime).toBe(replaced)
        expect(liveSlotAtFillTime).not.toBe(replacement)
    })

    test('setChar fills before installing the character', () => {
        installDb()
        selectedCharID.set(1)
        const api = makeApi()
        const replaced = DBState.db.characters[1]
        const replacement = makeCharacter(undefined, 'Replacement')
        let liveSlotAtFillTime: unknown
        const original = chatIdsModule.fillMissingCharacterInstallIds
        const spy = vi.spyOn(chatIdsModule, 'fillMissingCharacterInstallIds').mockImplementation((...args) => {
            liveSlotAtFillTime = DBState.db.characters[1]
            return original(...args)
        })

        api.setChar(replacement)

        spy.mockRestore()
        expect(liveSlotAtFillTime).toBe(replaced)
        expect(liveSlotAtFillTime).not.toBe(replacement)
    })
})

describe('reinstalling an object with its own unchanged id never warns', () => {
    // Coverage, not proof: an implementation that never warns about anything
    // would also satisfy both tests below, so passing here does not by
    // itself prove the newId === oldId shortcut runs -- only that neither
    // call warns.
    test('setChatToIndexImpl: reinstalling a chat with its own id does not warn about a duplicate elsewhere', () => {
        installDb()
        DBState.db.characters[0].chats = [
            makeChat('dup', 'first'),
            makeChat('dup', 'second'),
        ] as unknown as CharacterFixture['chats']
        const sameChat = { ...DBState.db.characters[0].chats[0] }
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        setChatToIndexImpl(0, 0, sameChat)

        const called = warnSpy.mock.calls.length > 0
        warnSpy.mockRestore()
        expect(called).toBe(false)
    })

    test('setCharacterToIndex: reinstalling a character with its own chaId does not warn about a duplicate elsewhere', () => {
        installDb()
        DBState.db.characters = [
            makeCharacter('dup', 'First'),
            makeCharacter('dup', 'Second'),
        ] as unknown as Database['characters']
        const api = makeApi()
        const sameChar = { ...DBState.db.characters[0] }
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        api.setCharacterToIndex(0, sameChar)

        const called = warnSpy.mock.calls.length > 0
        warnSpy.mockRestore()
        expect(called).toBe(false)
    })
})

describe('a chat-id duplicate check is skipped entirely once a chaId has more than one holder', () => {
    // This pins a known miss: once a chaId has more than one holder, the
    // chat-id duplicate check for its chats is skipped entirely, so a
    // duplicate chat id this very call introduces (here, 'a' appearing
    // twice in the reinstalled character's own chats) goes unreported.
    // Excluding this case from the skip should make this call warn about
    // that duplicate.
    test('once a chaId has more than one holder, a chat-id duplicate installed into one of them is not reported', () => {
        installDb()
        DBState.db.characters = [
            makeCharacter('k', 'Holds The Duplicate', [
                makeChat('a', 'a1'),
                makeChat('a', 'a2'),
            ]),
            makeCharacter('k', 'The Other Holder', [
                makeChat('other-chat', 'original'),
            ]),
        ] as unknown as Database['characters']
        const api = makeApi()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        api.setCharacterToIndex(1, makeCharacter('k', 'Reinstalled', [
            makeChat('a', 'a1-new'),
            makeChat('a', 'a2-new'),
        ]))

        const chatIdWarnings = warnSpy.mock.calls
            .flat()
            .filter((arg): arg is string => typeof arg === 'string' && arg.includes('chat id'))
        warnSpy.mockRestore()
        expect(chatIdWarnings.length).toBe(0)
    })
})

describe('duplicate chat id warnings on a v3 install', () => {
    test('a chat swap made with two setChatToIndexImpl calls: the first call warns, and the second does not warn again for the same duplicate', () => {
        installDb()
        DBState.db.characters[0].chats = [
            makeChat('x', 'x'),
            makeChat('k1', 'k'),
        ] as unknown as CharacterFixture['chats']
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const xChat = DBState.db.characters[0].chats[0]
        const kChat = DBState.db.characters[0].chats[1]

        // First call: kChat's id now lives at both slot 0 and slot 1.
        setChatToIndexImpl(0, 0, { ...kChat })
        const callsAfterFirst = warnSpy.mock.calls.length
        expect(callsAfterFirst).toBeGreaterThan(0)

        // Second call completes the swap; the duplicate the first call made
        // is still present until this call resolves it, so no new warning
        // is expected for it.
        setChatToIndexImpl(0, 1, { ...xChat })
        const callsAfterSecond = warnSpy.mock.calls.length

        warnSpy.mockRestore()
        expect(callsAfterSecond).toBe(callsAfterFirst)
    })

    // Exercises the real api.setChatToIndex wrapper from makeRisuaiAPIV3,
    // not setChatToIndexImpl directly: that wrapper is the only place the
    // plugin's own name reaches setChatToIndexImpl's pluginName parameter.
    test('a duplicate introduced through the v3 setChatToIndex wrapper warns and names the plugin', () => {
        installDb()
        DBState.db.characters[0].chats = [
            makeChat('x', 'x'),
            makeChat('k1', 'k'),
        ] as unknown as CharacterFixture['chats']
        const api = makeApi('naming-test-plugin')
        const kChat = DBState.db.characters[0].chats[1]
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        api.setChatToIndex(0, 0, { ...kChat })

        const warnedWithPluginName = warnSpy.mock.calls.some((args) =>
            args.some((a) => typeof a === 'string' && a.includes('naming-test-plugin')))
        warnSpy.mockRestore()
        expect(warnedWithPluginName).toBe(true)
    })
})

// Coverage, not proof: every chat sorted here already carries its own id
// before the sort starts, so neither the install fill nor the repair is ever
// exercised against a missing or duplicated id -- this pins that sorting by
// id, alone, does not disturb anything.
describe('after sorting every chat through setChatToIndexImpl, boot\'s repair changes nothing', () => {
    test('repairDatabaseIds leaves the sorted chats untouched', () => {
        installDb()
        const scrambled = [
            makeChat('c3', 'content-3'),
            makeChat('c1', 'content-1'),
            makeChat('c2', 'content-2'),
            makeChat('c0', 'content-0'),
        ]
        DBState.db.characters[0].chats = scrambled as unknown as CharacterFixture['chats']
        const sorted = [...scrambled].sort((a, b) => (a.id as string).localeCompare(b.id as string))
        for (let i = 0; i < sorted.length; i++) {
            setChatToIndexImpl(0, i, sorted[i])
        }

        const before = $state.snapshot(DBState.db.characters)
        repairDatabaseIds({ characters: DBState.db.characters as unknown as unknown[] })

        expect($state.snapshot(DBState.db.characters)).toEqual(before)
    })
})

describe('duplicate id warnings on a v3 install', () => {
    // Coverage, not proof: an implementation that never touches a present id
    // would also satisfy this, so it does not by itself prove ids are
    // preserved specifically when duplicated.
    test('a copy-idiom install through setCharacter keeps both ids, and the surrounding fill changes nothing else', () => {
        installDb()
        selectedCharID.set(0)
        const api = makeApi()
        const snapshot = api.getCharacterFromIndex(0) as CharacterFixture
        const copiedId = snapshot.chats[0].id
        const copiedName = snapshot.chats[0].name
        snapshot.chats.unshift({ ...snapshot.chats[0] })

        api.setCharacter(snapshot)

        expect(DBState.db.characters[0].chats[0].id).toBe(copiedId)
        expect(DBState.db.characters[0].chats[1].id).toBe(copiedId)
        expect(DBState.db.characters[0].chats[0].name).toBe(copiedName)
        expect(DBState.db.characters[0].chats[1].name).toBe(copiedName)
    })

    test('the same install logs a duplicate warning naming the plugin', () => {
        installDb()
        selectedCharID.set(0)
        const api = makeApi('test-plugin')
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const snapshot = api.getCharacterFromIndex(0) as CharacterFixture
        snapshot.chats.unshift({ ...snapshot.chats[0] })

        api.setCharacter(snapshot)

        const warnedWithPluginName = warnSpy.mock.calls.some(args =>
            args.some(a => typeof a === 'string' && a.includes('test-plugin')))
        warnSpy.mockRestore()
        expect(warnedWithPluginName).toBe(true)
    })

    // Coverage, not proof: this install's own duplicate check only ever
    // inspects character 1's chats, never character 0's, so this passes
    // whether or not the "already held" exemption exists -- it does not
    // exercise that exemption on the duplicate below.
    test('a duplicate present before the call is not blamed on a later, unrelated install', () => {
        installDb()
        // The duplicate is made directly on the fixture, never through any
        // install call, so no call has ever "introduced" it.
        DBState.db.characters[0].chats.unshift({ ...DBState.db.characters[0].chats[0] })
        const api = makeApi()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        // An unrelated install that does not touch the duplicated chats at all.
        api.setCharacterToIndex(1, api.getCharacterFromIndex(1) as CharacterFixture)

        const called = warnSpy.mock.calls.length > 0
        warnSpy.mockRestore()
        expect(called).toBe(false)
    })

    // Coverage, not proof: an implementation that never warns about anything
    // would also satisfy this, so passing here does not by itself prove the
    // "already held" exemption -- only that this call does not warn.
    test('reinstalling a character whose own chats already had a duplicate id does not warn about it', () => {
        installDb()
        DBState.db.characters[0].chats.unshift({ ...DBState.db.characters[0].chats[0] })
        const api = makeApi()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const snapshot = api.getCharacterFromIndex(0) as CharacterFixture
        api.setCharacterToIndex(0, snapshot)

        const called = warnSpy.mock.calls.length > 0
        warnSpy.mockRestore()
        expect(called).toBe(false)
    })

    test('a character swap made with two setCharacterToIndex calls: the first call warns with wording marking it as possibly transient, and the second does not warn again for the same duplicate', () => {
        installDb()
        const api = makeApi()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const char0 = api.getCharacterFromIndex(0) as CharacterFixture
        const char1 = api.getCharacterFromIndex(1) as CharacterFixture

        // First call: char1's chaId now lives at both slot 0 and slot 1.
        api.setCharacterToIndex(0, char1)
        const callsAfterFirst = warnSpy.mock.calls.length
        const transientWording = warnSpy.mock.calls.some(args =>
            args.some(a => typeof a === 'string' && /transient/i.test(a)))
        expect(callsAfterFirst).toBeGreaterThan(0)
        expect(transientWording).toBe(true)

        // Second call completes the swap; the duplicate the first call made
        // is still present until this call resolves it, so no new warning
        // is expected for it.
        api.setCharacterToIndex(1, char0)
        const callsAfterSecond = warnSpy.mock.calls.length

        warnSpy.mockRestore()
        expect(callsAfterSecond).toBe(callsAfterFirst)
    })
})

describe('a chat-id duplicate that predates a character swap is not blamed when the character carrying it is installed first', () => {
    function installMovedDuplicate(): void {
        installDb()
        DBState.db.characters[1].chats = [
            makeChat('d', 'd1'),
            makeChat('d', 'd2'),
        ] as unknown as CharacterFixture['chats']
    }

    // The swap also produces its own, separate chaId warning -- moving one
    // character's real chaId into the other's slot always leaves both
    // slots holding it until the second call resolves it, and that
    // warning is expected here regardless. Only the chat-id warning for
    // 'd' is under test: it must not fire, because character 1's own
    // chats already held that duplicate before either call.
    //
    // Coverage, not proof: holds whether or not duplicate warnings are
    // logged at all. It guards the per-owner attribution: it fails if the
    // check compares against the slot's previous occupant instead of the
    // same chaId's prior holder.
    test('via setCharacterToIndex: no chat-id warning when the character carrying the duplicate is installed first', () => {
        installMovedDuplicate()
        const api = makeApi()
        const char0 = api.getCharacterFromIndex(0) as CharacterFixture
        const char1 = api.getCharacterFromIndex(1) as CharacterFixture
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        api.setCharacterToIndex(0, char1)
        api.setCharacterToIndex(1, char0)

        const warnedAboutChatIdD = warnSpy.mock.calls.some((args) =>
            args.some((a) => typeof a === 'string' && a.includes('chat id (d)')))
        warnSpy.mockRestore()
        expect(warnedAboutChatIdD).toBe(false)
    })

    // Coverage, not proof: holds whether or not duplicate warnings are
    // logged at all. It guards the per-owner attribution: it fails if the
    // check compares against the slot's previous occupant instead of the
    // same chaId's prior holder.
    test('via setChar under a changing selection: no chat-id warning when the character carrying the duplicate is installed first', () => {
        installMovedDuplicate()
        const api = makeApi()
        const char0Snapshot = { ...DBState.db.characters[0] } as CharacterFixture
        const char1Snapshot = { ...DBState.db.characters[1] } as CharacterFixture
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        selectedCharID.set(0)
        api.setChar(char1Snapshot)
        selectedCharID.set(1)
        api.setChar(char0Snapshot)

        const warnedAboutChatIdD = warnSpy.mock.calls.some((args) =>
            args.some((a) => typeof a === 'string' && a.includes('chat id (d)')))
        warnSpy.mockRestore()
        expect(warnedAboutChatIdD).toBe(false)
    })
})

describe('a chat-id duplicate that predates a character swap, when the character carrying it is installed second', () => {
    function installMovedDuplicateOnCharacterZero(): void {
        installDb()
        DBState.db.characters[0].chats = [
            makeChat('d', 'd1'),
            makeChat('d', 'd2'),
        ] as unknown as CharacterFixture['chats']
    }

    // At the second call, the live database holds no character under the
    // chaId being installed -- both slots currently carry the OTHER
    // character's chaId, mid-swap -- so the chat-id check falls back to the
    // slot being replaced, not to the chaId's real prior holder. A warning
    // that fires here reports the duplicate's state; it must not assert
    // that this call, or the swap, produced it.
    test('via setCharacterToIndex: a chat-id warning here does not blame the swap, and says the duplicate may predate the call', () => {
        installMovedDuplicateOnCharacterZero()
        const api = makeApi()
        const char0 = api.getCharacterFromIndex(0) as CharacterFixture
        const char1 = api.getCharacterFromIndex(1) as CharacterFixture
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        api.setCharacterToIndex(0, char1)
        api.setCharacterToIndex(1, char0)

        const chatIdDWarnings = warnSpy.mock.calls
            .flat()
            .filter((a): a is string => typeof a === 'string' && a.includes('chat id (d)'))
        warnSpy.mockRestore()
        expect(chatIdDWarnings.length).toBeGreaterThan(0)
        expect(chatIdDWarnings.every((msg) => /may predate this call/i.test(msg))).toBe(true)
        expect(chatIdDWarnings.some((msg) => /installed a duplicate|introduced/i.test(msg))).toBe(false)
    })

    test('via setChar under a changing selection: a chat-id warning here does not blame the swap, and says the duplicate may predate the call', () => {
        installMovedDuplicateOnCharacterZero()
        const api = makeApi()
        const char0Snapshot = { ...DBState.db.characters[0] } as CharacterFixture
        const char1Snapshot = { ...DBState.db.characters[1] } as CharacterFixture
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        selectedCharID.set(0)
        api.setChar(char1Snapshot)
        selectedCharID.set(1)
        api.setChar(char0Snapshot)

        const chatIdDWarnings = warnSpy.mock.calls
            .flat()
            .filter((a): a is string => typeof a === 'string' && a.includes('chat id (d)'))
        warnSpy.mockRestore()
        expect(chatIdDWarnings.length).toBeGreaterThan(0)
        expect(chatIdDWarnings.every((msg) => /may predate this call/i.test(msg))).toBe(true)
        expect(chatIdDWarnings.some((msg) => /installed a duplicate|introduced/i.test(msg))).toBe(false)
    })
})

describe('the duplicate-id warning reports state after the call, not blame', () => {
    test('a chat-id duplicate warning contains the full wording contract', () => {
        installDb()
        selectedCharID.set(0)
        const api = makeApi('wording-test-plugin')
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const snapshot = api.getCharacterFromIndex(0) as CharacterFixture
        snapshot.chats.unshift({ ...snapshot.chats[0] })

        api.setCharacter(snapshot)

        const messages = warnSpy.mock.calls
            .flat()
            .filter((a): a is string => typeof a === 'string' && a.includes('chat id'))
        warnSpy.mockRestore()
        expect(messages.length).toBeGreaterThan(0)
        for (const msg of messages) {
            expect(msg).toMatch(/may be transient/i)
            expect(msg).toMatch(/may predate this call/i)
            expect(msg).toMatch(/writes addressed by id to either holder are skipped/i)
            expect(msg).toContain('wording-test-plugin')
            expect(msg).not.toMatch(/installed a duplicate|introduced/i)
        }
    })

    test('a chaId duplicate warning contains the full wording contract, including the save-pause consequence', () => {
        installDb()
        const api = makeApi('wording-test-plugin-2')
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        api.setCharacterToIndex(1, makeCharacter('char-0', 'Duplicate Zero'))

        const messages = warnSpy.mock.calls
            .flat()
            .filter((a): a is string => typeof a === 'string' && a.includes('chaId'))
        warnSpy.mockRestore()
        expect(messages.length).toBeGreaterThan(0)
        for (const msg of messages) {
            expect(msg).toMatch(/may be transient/i)
            expect(msg).toMatch(/may predate this call/i)
            expect(msg).toMatch(/writes addressed by id to either holder are skipped/i)
            expect(msg).toMatch(/saving is paused for that chaId/i)
            expect(msg).toMatch(/last saved block is kept/i)
            expect(msg).toContain('wording-test-plugin-2')
            expect(msg).not.toMatch(/installed a duplicate|introduced/i)
        }
    })
})

describe('a duplicate introduced through each v3 install path warns and names the plugin', () => {
    const pluginName = 'route-naming-plugin'
    type ApiUnderTest = ReturnType<typeof makeApi>
    const cases: Array<[string, (api: ApiUnderTest) => void | Promise<void>]> = [
        ['setChar', (api) => {
            selectedCharID.set(1)
            api.setChar(makeCharacter('char-0', 'Duplicate Zero'))
        }],
        ['setDatabaseLite', (api) => {
            api.setDatabaseLite({
                characters: [
                    makeCharacter('char-0', 'Copy A'),
                    makeCharacter('char-0', 'Copy B'),
                ],
            })
        }],
        ['setDatabase', async (api) => {
            await api.setDatabase({
                characters: [
                    makeCharacter('char-0', 'Copy A'),
                    makeCharacter('char-0', 'Copy B'),
                ],
            })
        }],
        ['setCharacterToIndex, the chaId warning', (api) => {
            api.setCharacterToIndex(1, makeCharacter('char-0', 'Duplicate Zero'))
        }],
        ['setCharacterToIndex, the within-character chat-id warning', (api) => {
            api.setCharacterToIndex(1, makeCharacter(undefined, 'Dup Chats', [
                makeChat('dup-chat', 'a'),
                makeChat('dup-chat', 'b'),
            ]))
        }],
    ]

    test.each(cases)('%s', async (_label, run) => {
        installDb()
        const api = makeApi(pluginName)
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await run(api)

        const warnedWithPluginName = warnSpy.mock.calls.some((args) =>
            args.some((a) => typeof a === 'string' && a.includes(pluginName)))
        warnSpy.mockRestore()
        expect(warnedWithPluginName).toBe(true)
    })
})

// Coverage, not proof: every chat and character swapped or sorted below
// already carries its own id or chaId from the moment the fixture is built,
// so none of the three tests here ever exercises the fill against a missing
// id -- they pin that a present id is never moved or reassigned by a swap or
// a sort, independent of whether the fill runs at all.
describe('chat and character swaps and sorts done with per-slot v3 setters keep every id with its own content', () => {
    test('a chat swap made with two setChatToIndexImpl calls ends [k3, k1, k2, k0], each id with its own content', () => {
        installDb()
        DBState.db.characters[0].chats = [
            makeChat('k0', 'content-0'),
            makeChat('k1', 'content-1'),
            makeChat('k2', 'content-2'),
            makeChat('k3', 'content-3'),
        ] as unknown as CharacterFixture['chats']

        const original0 = DBState.db.characters[0].chats[0]
        const original3 = DBState.db.characters[0].chats[3]
        setChatToIndexImpl(0, 0, original3)
        setChatToIndexImpl(0, 3, original0)

        const ids = DBState.db.characters[0].chats.map(c => c.id)
        expect(ids).toEqual(['k3', 'k1', 'k2', 'k0'])
        for (const chat of DBState.db.characters[0].chats) {
            expect(chat.name).toBe(`content-${(chat.id as string).slice(1)}`)
        }
    })

    test('a sort of every chat by id, done through setChatToIndexImpl, keeps every id with its own content', () => {
        installDb()
        const scrambled = [
            makeChat('c3', 'content-3'),
            makeChat('c1', 'content-1'),
            makeChat('c2', 'content-2'),
            makeChat('c0', 'content-0'),
        ]
        DBState.db.characters[0].chats = scrambled as unknown as CharacterFixture['chats']
        const sorted = [...scrambled].sort((a, b) => (a.id as string).localeCompare(b.id as string))

        for (let i = 0; i < sorted.length; i++) {
            setChatToIndexImpl(0, i, sorted[i])
        }

        const ids = DBState.db.characters[0].chats.map(c => c.id)
        expect(ids).toEqual(['c0', 'c1', 'c2', 'c3'])
        for (const chat of DBState.db.characters[0].chats) {
            expect(chat.name).toBe(`content-${(chat.id as string).slice(1)}`)
        }
    })

    test('a character swap made with two setCharacterToIndex calls, then a full encode and decode: each character appears once with its own chaId', async () => {
        installDb()
        const api = makeApi()
        const char0 = api.getCharacterFromIndex(0) as CharacterFixture
        const char1 = api.getCharacterFromIndex(1) as CharacterFixture
        api.setCharacterToIndex(0, char1)
        api.setCharacterToIndex(1, char0)

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        const decodedChar0 = decoded.characters.find((c: CharacterFixture) => c.chaId === 'char-0')
        const decodedChar1 = decoded.characters.find((c: CharacterFixture) => c.chaId === 'char-1')
        expect(decoded.characters.filter((c: CharacterFixture) => c.chaId === 'char-0').length).toBe(1)
        expect(decoded.characters.filter((c: CharacterFixture) => c.chaId === 'char-1').length).toBe(1)
        expect(decodedChar0!.name).toBe('Character Zero')
        expect(decodedChar1!.name).toBe('Character One')
    })
})

// Coverage, not proof: a fill that did nothing at all would also not throw,
// so passing here does not by itself prove the fill tolerates malformed
// input -- only that nothing in these three routes throws on it.
describe('malformed input does not throw in these routes', () => {
    test('setCharacterToIndex with a character that has no chats', () => {
        installDb()
        const api = makeApi()
        expect(() => api.setCharacterToIndex(1, { chaId: 'no-chats' } as unknown as CharacterFixture)).not.toThrow()
    })

    test('setChar with a character that has no chats', () => {
        installDb()
        selectedCharID.set(1)
        const api = makeApi()
        expect(() => api.setChar({ chaId: 'no-chats' } as unknown as CharacterFixture)).not.toThrow()
    })

    test('setChatToIndexImpl with a chat missing every field', () => {
        installDb()
        expect(() => setChatToIndexImpl(0, 0, {} as unknown as ChatFixture)).not.toThrow()
    })
})
