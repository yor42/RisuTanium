/**
 * The real V2.1 plugin `setDatabase` / `setDatabaseLite`
 * (`src/ts/plugins/plugins.svelte.ts`, `getV2PluginAPIs()`) fill a missing
 * chat id or `chaId` on every incoming character, including through the
 * live-proxy `getDatabase()` idiom, driven through the actual plugin-facing
 * `getDatabase()` Proxy wrapper those APIs return. This file also pins the
 * save format's current one-`chaId`-one-block behaviour with a full
 * `RisuSaveEncoder` encode/decode round trip. Module-mock set copied,
 * unchanged in shape, from `pluginSetDatabaseSaveMarks.svelte.test.ts` (the
 * existing precedent for driving the real `getV2PluginAPIs()` against a real
 * `storage/database.svelte` stand-in).
 */
import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'

//#region module mocks -- copied from pluginSetDatabaseSaveMarks.svelte.test.ts

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
import { DBState } from '../../stores.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../storage/risuSave'
import type { toSaveType } from '../../storage/risuSave'
import * as chatIdsModule from '../../process/chatIds'

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
            makeCharacter('char-0', 'Character Zero', [
                makeChat('char-0-chat-0', 'Char0 chat0'),
            ]),
            makeCharacter('char-1', 'Character One'),
        ],
    } as unknown as Database
    DBState.db = db
    // Read DBState.db back AFTER assignment (Svelte re-proxies on assign), so
    // getDatabase() below returns the SAME live reactive proxy the rest of
    // this test (and the real production code) reads/writes through.
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

//#endregion

describe('setDatabase / setDatabaseLite fill every missing id on the incoming characters', () => {
    test('setDatabase gives a fresh id to an id-less chat in an existing character, and to a whole new id-less character', async () => {
        installDb()
        const api = getV2PluginAPIs()

        const freshCharacters = [
            makeCharacter('char-0', 'Character Zero (v2 fresh)', [
                makeChat(undefined, 'unshifted copy'),
                makeChat('char-0-chat-0', 'Char0 chat0'),
            ]),
            makeCharacter(undefined, 'Brand New Character'),
        ]
        await api.setDatabase({ characters: freshCharacters })

        const [char0, newChar] = DBState.db.characters
        expect(typeof char0.chats[0].id).toBe('string')
        expect((char0.chats[0].id as string).length).toBeGreaterThan(0)
        expect(char0.chats[1].id).toBe('char-0-chat-0')

        expect(typeof newChar.chaId).toBe('string')
        expect((newChar.chaId as string).length).toBeGreaterThan(0)
        expect(typeof newChar.chats[0].id).toBe('string')
        expect((newChar.chats[0].id as string).length).toBeGreaterThan(0)
    })

    test('setDatabaseLite gives a fresh id to an id-less chat in an existing character, and to a whole new id-less character', () => {
        installDb()
        const api = getV2PluginAPIs()

        const freshCharacters = [
            makeCharacter('char-0', 'Character Zero (v2 fresh)', [
                makeChat(undefined, 'unshifted copy'),
                makeChat('char-0-chat-0', 'Char0 chat0'),
            ]),
            makeCharacter(undefined, 'Brand New Character'),
        ]
        api.setDatabaseLite({ characters: freshCharacters })

        const [char0, newChar] = DBState.db.characters
        expect(typeof char0.chats[0].id).toBe('string')
        expect((char0.chats[0].id as string).length).toBeGreaterThan(0)
        expect(char0.chats[1].id).toBe('char-0-chat-0')

        expect(typeof newChar.chaId).toBe('string')
        expect((newChar.chaId as string).length).toBeGreaterThan(0)
        expect(typeof newChar.chats[0].id).toBe('string')
        expect((newChar.chats[0].id as string).length).toBeGreaterThan(0)
    })

    test('the v2.1 live-proxy idiom: unshifting an id-less chat directly, then setDatabaseLite(getDatabase()), gives it an id', () => {
        installDb()
        const api = getV2PluginAPIs()

        const liveDb = api.getDatabase() as unknown as Database
        liveDb.characters[0].chats.unshift(makeChat(undefined, 'live-proxy unshift'))
        api.setDatabaseLite(api.getDatabase())

        expect(typeof DBState.db.characters[0].chats[0].id).toBe('string')
        expect((DBState.db.characters[0].chats[0].id as string).length).toBeGreaterThan(0)
    })

    test('setDatabaseLite fills every id before installing the incoming characters', () => {
        installDb()
        const api = getV2PluginAPIs()
        const beforeCharacters = DBState.db.characters
        const freshCharacters = [makeCharacter(undefined, 'Brand New')]
        let dbCharactersAtFillTime: unknown
        const original = chatIdsModule.fillMissingDatabaseInstallIds
        const spy = vi.spyOn(chatIdsModule, 'fillMissingDatabaseInstallIds').mockImplementation((newDb) => {
            dbCharactersAtFillTime = DBState.db.characters
            return original(newDb)
        })

        api.setDatabaseLite({ characters: freshCharacters })

        spy.mockRestore()
        expect(dbCharactersAtFillTime).toBe(beforeCharacters)
        expect(dbCharactersAtFillTime).not.toBe(DBState.db.characters)
    })
})

describe('setDatabase / setDatabaseLite never fill an id by the position of the character or chat being inserted', () => {
    function buildIncoming(): CharacterFixture[] {
        return [
            // Inserted ahead of the existing characters, at the same index
            // an id-by-position fill would read from.
            makeCharacter(undefined, 'Brand New At Front', [
                makeChat(undefined, 'new char chat'),
            ]),
            makeCharacter('char-0', 'Character Zero (v2 fresh)', [
                makeChat(undefined, 'unshifted copy'),
                makeChat('char-0-chat-0', 'Char0 chat0'),
            ]),
            makeCharacter('char-1', 'Character One'),
        ]
    }

    function checkNoIdWasTakenByPosition(): void {
        const priorChaIds = ['char-0', 'char-1']
        const priorChatIds = ['char-0-chat-0', 'char-1-chat-0']
        const characters = DBState.db.characters

        const chaIds = characters.map((c) => c.chaId)
        expect(new Set(chaIds).size).toBe(chaIds.length)
        expect(priorChaIds).not.toContain(chaIds[0])

        const newFrontChatId = characters[0].chats[0].id
        expect(priorChatIds).not.toContain(newFrontChatId)

        const unshiftedChatId = characters[1].chats[0].id
        expect(priorChatIds).not.toContain(unshiftedChatId)

        for (const character of characters) {
            const chatIds = character.chats.map((c) => c.id)
            expect(new Set(chatIds).size).toBe(chatIds.length)
        }
    }

    // Coverage, not proof: a fill that did nothing would also pass here,
    // since an undefined chaId and an undefined chat id each match no
    // prior one. This guards against an id taken by position instead of a
    // fresh uuid, and cannot show that the fill runs at all.
    test('setDatabaseLite', () => {
        installDb()
        const api = getV2PluginAPIs()

        api.setDatabaseLite({ characters: buildIncoming() })

        checkNoIdWasTakenByPosition()
    })

    // Coverage, not proof: same reasoning as setDatabaseLite above.
    test('setDatabase', async () => {
        installDb()
        const api = getV2PluginAPIs()

        await api.setDatabase({ characters: buildIncoming() })

        checkNoIdWasTakenByPosition()
    })
})

// Coverage, not proof: this character already carries its own chaId, and a
// fill that did nothing at all would also not throw, so passing here does
// not by itself prove the fill tolerates a missing chats array -- only that
// nothing in these two routes throws on it.
describe('malformed input does not throw in setDatabase / setDatabaseLite', () => {
    test('setDatabase does not throw when an incoming character has no chats', async () => {
        installDb()
        const api = getV2PluginAPIs()
        await expect(api.setDatabase({
            characters: [{ chaId: 'no-chats', name: 'NoChats', type: 'character', chatPage: 0 }],
        })).resolves.not.toThrow()
    })

    test('setDatabaseLite does not throw when an incoming character has no chats', () => {
        installDb()
        const api = getV2PluginAPIs()
        expect(() => api.setDatabaseLite({
            characters: [{ chaId: 'no-chats-2', name: 'NoChats2', type: 'character', chatPage: 0 }],
        })).not.toThrow()
    })
})

// Coverage, not proof: getDatabase() returns the live characters array
// itself, so nothing here can ever be "introduced" for the fill or the
// duplicate walk to act on -- an implementation that skipped both entirely
// would also leave every object identity exactly as it was.
describe('setDatabaseLite(getDatabase()) with no plugin edits', () => {
    test('changes nothing: characters and each character keep their object identity', () => {
        installDb()
        const api = getV2PluginAPIs()

        const beforeCharacters = DBState.db.characters
        const beforeChar0 = DBState.db.characters[0]
        const beforeChar1 = DBState.db.characters[1]

        api.setDatabaseLite(api.getDatabase())

        expect(DBState.db.characters).toBe(beforeCharacters)
        expect(DBState.db.characters[0]).toBe(beforeChar0)
        expect(DBState.db.characters[1]).toBe(beforeChar1)
    })
})

describe('setDatabase / setDatabaseLite warn about a chaId or chat id duplicate only when the incoming value counts it twice or more and the baseline just before the call did not', () => {
    // Coverage, not proof: an implementation that never warns about a
    // duplicate chaId at all would also satisfy this assertion, so passing
    // here does not by itself prove the "already held" exemption.
    test('a chaId duplicate the database already held is not blamed on a call that leaves it as-is', () => {
        installDb()
        DBState.db.characters = [
            makeCharacter('dup-id', 'First'),
            makeCharacter('dup-id', 'Second'),
        ] as unknown as Database['characters']
        const api = getV2PluginAPIs()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const sameDuplicate = $state.snapshot(DBState.db.characters) as unknown as CharacterFixture[]
        api.setDatabaseLite({ characters: sameDuplicate })

        const warnedAboutDupId = warnSpy.mock.calls.some((args) =>
            args.some((a) => typeof a === 'string' && a.includes('dup-id')))
        warnSpy.mockRestore()
        expect(warnedAboutDupId).toBe(false)
    })

    test('the same call introducing a new chaId duplicate warns exactly once', () => {
        installDb()
        const api = getV2PluginAPIs()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const introducedDuplicate = [
            makeCharacter('char-0', 'Character Zero (copy A)'),
            makeCharacter('char-0', 'Character Zero (copy B)'),
        ]
        api.setDatabaseLite({ characters: introducedDuplicate })

        const warningsAboutCharZero = warnSpy.mock.calls.filter((args) =>
            args.some((a) => typeof a === 'string' && a.includes('char-0')))
        warnSpy.mockRestore()
        expect(warningsAboutCharZero.length).toBe(1)
    })

    // Coverage, not proof: an implementation that never warns about anything
    // would also satisfy this, so passing here does not by itself prove the
    // "already held" exemption -- only that this call does not warn.
    test('a chat id duplicate an existing character already held is not blamed on a call that leaves it as-is', () => {
        installDb()
        const charWithDup = makeCharacter('char-0', 'Character Zero', [
            makeChat('dup', 'first'),
            makeChat('dup', 'second'),
        ])
        DBState.db.characters = [charWithDup, DBState.db.characters[1]] as unknown as Database['characters']
        const api = getV2PluginAPIs()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const sameCharacters = $state.snapshot(DBState.db.characters) as unknown as CharacterFixture[]
        api.setDatabaseLite({ characters: sameCharacters })

        const warnedAboutDup = warnSpy.mock.calls.some((args) =>
            args.some((a) => typeof a === 'string' && a.includes('dup')))
        warnSpy.mockRestore()
        expect(warnedAboutDup).toBe(false)
    })

    test('an incoming character whose own chats share a new id twice warns exactly once (setDatabaseLite)', () => {
        installDb()
        const api = getV2PluginAPIs()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const introducedChatDuplicate = [
            makeCharacter('char-2', 'Character Two', [
                makeChat('shared-new-lite', 'first'),
                makeChat('shared-new-lite', 'second'),
            ]),
        ]
        api.setDatabaseLite({ characters: introducedChatDuplicate })

        const warningsAboutSharedId = warnSpy.mock.calls.filter((args) =>
            args.some((a) => typeof a === 'string' && a.includes('shared-new-lite')))
        warnSpy.mockRestore()
        expect(warningsAboutSharedId.length).toBe(1)
    })

    test('an incoming character whose own chats share a new id twice warns exactly once (setDatabase)', async () => {
        installDb()
        const api = getV2PluginAPIs()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const introducedChatDuplicate = [
            makeCharacter('char-2', 'Character Two', [
                makeChat('shared-new-full', 'first'),
                makeChat('shared-new-full', 'second'),
            ]),
        ]
        await api.setDatabase({ characters: introducedChatDuplicate })

        const warningsAboutSharedId = warnSpy.mock.calls.filter((args) =>
            args.some((a) => typeof a === 'string' && a.includes('shared-new-full')))
        warnSpy.mockRestore()
        expect(warningsAboutSharedId.length).toBe(1)
    })

    // The incoming character is a brand new object, never `===` any element
    // of the live array, even though its chaId matches a prior holder there:
    // an incoming object's own identity, not its chaId, is what exempts a
    // character from having its chats counted.
    test('a new character object sharing a chaId with a prior holder still gets its own chats counted when a chat is replaced by a copy of its sibling (setDatabaseLite)', () => {
        installDb()
        DBState.db.characters = [
            DBState.db.characters[0],
            makeCharacter('char-1', 'Character One', [
                makeChat('char-1-chat-0', 'first'),
                makeChat('char-1-chat-1', 'second'),
            ]),
        ] as unknown as Database['characters']
        const api = getV2PluginAPIs()
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const newChar1 = makeCharacter('char-1', 'Character One (edited)', [
            makeChat('char-1-chat-0', 'first'),
            makeChat('char-1-chat-0', 'second, replaced by a copy of the first'),
        ])
        api.setDatabaseLite({ characters: [DBState.db.characters[0], newChar1] })

        const warningsAboutSharedId = warnSpy.mock.calls.filter((args) =>
            args.some((a) => typeof a === 'string' && a.includes('char-1-chat-0')))
        warnSpy.mockRestore()
        expect(warningsAboutSharedId.length).toBe(1)
    })
})

describe('the save format holds one block per chaId', () => {
    // MC-078, MC-079: while a chaId is held by two characters, the block
    // already saved for it is what the file keeps, regardless of which
    // holder's mark set() processes or where each holder falls in the list.
    // Listing the copy ahead of the already-saved original below is what
    // makes this fail against a set() that simply overwrites the block from
    // whichever holder its linear scan reaches while the mark is still
    // present -- the fixed outcome itself does not depend on the order.
    test('a marked set() pass keeps the block already saved for a chaId held by two characters', async () => {
        installDb()
        const original = makeCharacter('dup-id', 'First')
        const encoder = new RisuSaveEncoder()
        // A block for 'dup-id' already exists, saved while it had only one
        // holder.
        await encoder.init(snapshotDb({ ...($state.snapshot(DBState.db) as Database), characters: [original] } as unknown as Database), { compression: false })

        const copy = makeCharacter('dup-id', 'Second')
        DBState.db.characters = [copy, original] as unknown as Database['characters']
        const toSave: toSaveType = {
            character: ['dup-id'],
            chat: [],
            botPreset: false,
            modules: false,
            loadouts: false,
            plugins: false,
            pluginCustomStorage: false,
        }
        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        // The save file still holds exactly one block per chaId.
        const matches = decoded.characters.filter((c: CharacterFixture) => c.chaId === 'dup-id')
        expect(matches.length).toBe(1)
        // And that block is the one already saved, not the copy that
        // consumed this pass's mark.
        expect(matches[0].name).toBe('First')
    })
})
