/**
 * Plugin reads and writes and the alternatives of a chat (`Chat.alt`).
 *
 * Reads: `getDatabase`, `getCharacter`, `getChar`, `getCharacterFromIndex` and `getChatFromIndex`, live and
 * archived, never show `alt`. Writes: `setCharacter`, `setChar`, `setCharacterToIndex`, `setChatToIndex`,
 * `setDatabase` and `setDatabaseLite` (V2 and V3) keep the live alternatives of the chat they replace, matched
 * by chat id, drop whatever `alt` the plugin sent, re-attach records whose parent left the path and clear the
 * alternatives of a chat written empty over a non-empty one. A full character written over an archived
 * placeholder restores it first and refuses the whole write when that fails or the target is archived again.
 *
 * Over the REAL `v3.svelte.ts` and `plugins.svelte.ts` (the module-mock set of `pluginSupaEmptyChat.svelte.test.ts`).
 * Test kinds: "guard:" rows pass before and after the change; the others are regression reproducers or
 * new-rule guards as marked, and fail on the code that assigns the plugin's data as it is.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())
/** Every text shown to the user, except progress notices. */
const notices = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                // A stored recent 'db' grant keeps the character and database APIs
                // from prompting; every other key is absent.
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
                }
                return null
            }),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
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

vi.mock(import('../../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../../storage/database.svelte')
})

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

vi.mock(import('../transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../transpiler'))

vi.mock(import('../../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: writable(false),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => {
    const show = (msg: string | Error) => { notices.texts.push(msg instanceof Error ? msg.message : String(msg)) }
    return {
        alertConfirm: alertConfirmMock,
        alertPluginConfirm: alertConfirmMock,
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async (msg: string) => { show(msg) }),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async (msg: string) => { show(msg) }),
        alertMd: vi.fn(show),
        alertToast: vi.fn(show),
        alertWait: vi.fn(() => ({})),
        alertClear: vi.fn(),
        waitAlert: vi.fn(async () => {}),
    } as unknown as typeof import('../../../alert')
})

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    getFetchLogs: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
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
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: hasherMock,
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

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { getV2PluginAPIs } from '../../plugins.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { buildColdStub } from '../../../process/coldCharacter'
import { getCurrentCharacter } from '../../../storage/database.svelte'


//#region fixtures

type CharacterFixture = Database['characters'][number]
type ColdCharacter = character & { coldstorage?: string }

const PLUGIN_NAME = 'cold-test-plugin'

function makePlugin(): RisuPlugin {
    return {
        name: PLUGIN_NAME,
        script: 'cold-characters-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeChat(id: string, text: string) {
    return { id, message: [{ role: 'user', data: text, time: 1 }], note: '', name: id, localLore: [] }
}

/** A full character with the fields the tests read. */
function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 5000,
        desc: `${chaId} description`,
        globalLore: [{ comment: `${chaId} lore`, content: `${chaId} lore content`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }],
        chats: [makeChat(`${chaId}-chat-0`, 'first'), makeChat(`${chaId}-chat-1`, 'second'), makeChat(`${chaId}-chat-2`, 'third')],
        ...extra,
    } as unknown as character
}

/**
 * The stub as it sits in the list after load: the fields the boot-time format
 * check fills on every character are default-filled.
 */
function stubOf(full: character, key: string): CharacterFixture {
    const stub = buildColdStub(full, key, []) as unknown as Record<string, unknown>
    Object.assign(stub, { customscript: [], firstMessage: '', globalLore: [], desc: '', viewScreen: 'none', emotionImages: [] })
    return stub as unknown as CharacterFixture
}

interface UnitEntry { kind: 'ok', character: unknown }
const units = new Map<string, UnitEntry | { kind: 'error' }>()

function putUnit(key: string, stored: unknown): void {
    units.set(key, { kind: 'ok', character: stored })
}

function installUnitReader(): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => {
        const entry = units.get(key)
        if (!entry) {
            return { status: 'missing' }
        }
        if (entry.kind === 'error') {
            return { status: 'error', error: new Error('unit unreadable') }
        }
        return { status: 'ok', value: { character: structuredClone(entry.character) } }
    })
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: PLUGIN_NAME, script: '' }],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
    } as unknown as Database
}

type Entry = Record<string, unknown>

const PATH = ['m1', 'm2']

function rec(id: string, p: string | null, a: number): Entry {
    return { m: { role: 'char', data: id, chatId: id, time: a }, p, a }
}

const sent = (...ids: string[]) => ids.map((chatId) => ({ role: 'user', data: chatId, chatId, time: 1 }))

/** A chat whose path is `ids` and whose alternatives are `alt` (absent when null). */
function altChat(id: string, ids: string[], alt: Entry[] | null): Entry {
    return { id, message: sent(...ids), note: '', name: id, localLore: [], ...(alt ? { alt } : {}) }
}

function charWithAlt(chaId: string, alt: Entry[] | null = [rec('x', 'm1', 1)], ids: string[] = PATH): character {
    return fullCharacter(chaId, { chats: [altChat(`${chaId}-chat-0`, ids, alt)] })
}

/** What a plugin writes back after reading: the same character, no `alt`, one message edited. */
function pluginCopy(chaId: string, ids: string[] = PATH, edit = 'edited'): Entry {
    const chat = altChat(`${chaId}-chat-0`, ids, null)
    const first = (chat.message as Entry[])[0]
    if (first) {
        first.data = edit
    }
    return { ...(fullCharacter(chaId) as unknown as Entry), chats: [chat] }
}

const liveChat = (index: number, chatIndex = 0) => DBState.db.characters[index].chats[chatIndex] as unknown as { message: Entry[], alt?: Entry[] }
const liveAlt = (index: number, chatIndex = 0) => $state.snapshot(liveChat(index, chatIndex).alt)
const api2 = () => getV2PluginAPIs()
const api3 = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

function installTwoWithAlt(): void {
    installDb([charWithAlt('a') as unknown as CharacterFixture, charWithAlt('b', [rec('y', 'm2', 1)]) as unknown as CharacterFixture])
}

const A_ALT = [rec('x', 'm1', 1)]
const B_ALT = [rec('y', 'm2', 1)]

//#endregion

beforeEach(() => {
    units.clear()
    readColdStorageItemMock.mockReset()
    installUnitReader()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    selectedCharID.set(0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('plugin reads never show a chat\'s alternatives', () => {
    // new-rule guards: nothing hid `alt` before, so each row fails on the code without the hiding
    test('getDatabase', async () => {
        installTwoWithAlt()
        const db = await api3().getDatabase() as { characters: unknown }
        expect(JSON.stringify(db.characters)).not.toContain('"alt"')
        expect(liveAlt(0)).toEqual(A_ALT)
    })

    test('getCharacter, getChar and getCharacterFromIndex', async () => {
        installTwoWithAlt()
        vi.mocked(getCurrentCharacter).mockImplementation(() => $state.snapshot(DBState.db.characters[0]) as never)
        expect(JSON.stringify(await api3().getCharacter())).not.toContain('"alt"')
        expect(JSON.stringify(await api3().getChar())).not.toContain('"alt"')
        expect(JSON.stringify(await api3().getCharacterFromIndex(1))).not.toContain('"alt"')
        expect(liveAlt(0)).toEqual(A_ALT)
        expect(liveAlt(1)).toEqual(B_ALT)
    })

    test('getChatFromIndex', async () => {
        installTwoWithAlt()
        expect(JSON.stringify(await api3().getChatFromIndex(1, 0))).not.toContain('"alt"')
        expect(liveAlt(1)).toEqual(B_ALT)
    })

    test('an archived character\'s copy and its chat', async () => {
        const full = charWithAlt('hero')
        putUnit('unit-hero', full)
        installDb([charWithAlt('warm') as unknown as CharacterFixture, stubOf(full, 'unit-hero')])
        expect(JSON.stringify(await api3().getCharacterFromIndex(1))).not.toContain('"alt"')
        expect(JSON.stringify(await api3().getChatFromIndex(1, 0))).not.toContain('"alt"')
    })
})

describe('a plugin write that carries no alt keeps the live alternatives', () => {
    // regression reproducers: on the code that assigns the plugin's chats as they are, `alt` is gone
    const writers: [string, () => Promise<void>][] = [
        ['V3 setCharacter', () => api3().setCharacter(pluginCopy('a'))],
        ['V3 setChar', () => api3().setChar(pluginCopy('a'))],
        ['V3 setCharacterToIndex', () => api3().setCharacterToIndex(0, pluginCopy('a'))],
        ['V3 setChatToIndex', () => api3().setChatToIndex(0, 0, (pluginCopy('a').chats as Entry[])[0])],
        ['V3 setDatabase', () => api3().setDatabase({ characters: [pluginCopy('a'), pluginCopy('b', PATH, 'b edit')] })],
        ['V3 setDatabaseLite', () => api3().setDatabaseLite({ characters: [pluginCopy('a'), pluginCopy('b', PATH, 'b edit')] })],
        ['V2 setChar', async () => { api2().setChar(pluginCopy('a')) }],
        ['V2 setDatabase', () => api2().setDatabase({ characters: [pluginCopy('a'), pluginCopy('b', PATH, 'b edit')] })],
        ['V2 setDatabaseLite', async () => { await api2().setDatabaseLite({ characters: [pluginCopy('a'), pluginCopy('b', PATH, 'b edit')] }) }],
    ]

    test.each(writers)('%s', async (_name, write) => {
        installTwoWithAlt()
        await write()
        expect(liveChat(0).message[0].data).toBe('edited')
        expect(liveAlt(0)).toEqual(A_ALT)
    })

    test('the array writers also keep the alternatives of the other characters', async () => {
        installTwoWithAlt()
        await api3().setDatabase({ characters: [pluginCopy('a'), pluginCopy('b', PATH, 'b edit')] })
        expect(liveAlt(1)).toEqual(B_ALT)
    })

    test('whatever alt the plugin writes is dropped; the live alt wins', async () => {
        installTwoWithAlt()
        const copy = pluginCopy('a')
        ;(copy.chats as Entry[])[0].alt = [rec('evil', null, 9)]
        await api3().setCharacterToIndex(0, copy)
        expect(liveAlt(0)).toEqual(A_ALT)
        const chat = altChat('a-chat-0', PATH, [rec('evil', null, 9)])
        await api3().setChatToIndex(0, 0, chat)
        expect(liveAlt(0)).toEqual(A_ALT)
    })

    test('guard: setDatabase(getDatabase()) keeps every alternative (passes before and after)', async () => {
        installTwoWithAlt()
        await api3().setDatabase(await api3().getDatabase() as never)
        expect(liveAlt(0)).toEqual(A_ALT)
        expect(liveAlt(1)).toEqual(B_ALT)
    })

    test('chats are continued by id, not by position', async () => {
        installDb([fullCharacter('a', {
            chats: [altChat('c1', PATH, [rec('x1', 'm1', 1)]), altChat('c2', PATH, [rec('x2', 'm1', 2)])],
        }) as unknown as CharacterFixture])
        const copy = pluginCopy('a')
        copy.chats = [altChat('c2', PATH, null), altChat('c1', PATH, null)]
        await api3().setCharacterToIndex(0, copy)
        expect((liveAlt(0, 0) ?? [])[0].m).toMatchObject({ chatId: 'x2' })
        expect((liveAlt(0, 1) ?? [])[0].m).toMatchObject({ chatId: 'x1' })
    })

    test('a chat the plugin leaves out takes its alternatives with it', async () => {
        installTwoWithAlt()
        const copy = pluginCopy('a')
        copy.chats = []
        await api3().setCharacterToIndex(0, copy)
        expect(DBState.db.characters[0].chats).toHaveLength(0)
        expect(liveAlt(1)).toEqual(B_ALT)
    })

    test('a chat written with an empty path over a non-empty one is a full clear', async () => {
        installTwoWithAlt()
        await api3().setChatToIndex(0, 0, altChat('a-chat-0', [], null))
        expect('alt' in liveChat(0)).toBe(false)
        await api3().setCharacterToIndex(1, { ...pluginCopy('b'), chats: [altChat('b-chat-0', [], null)] })
        expect('alt' in liveChat(1)).toBe(false)
    })

    test('a record whose parent the plugin removed from the path is attached to the root', async () => {
        installTwoWithAlt()
        await api3().setChatToIndex(0, 0, altChat('a-chat-0', ['m2'], null))
        expect((liveAlt(0) ?? [])[0].p).toBeNull()
    })

    test('an unrelated write clears nothing', async () => {
        installTwoWithAlt()
        await api3().setDatabase({ characters: [pluginCopy('a'), pluginCopy('b', [], 'b edit')] })
        expect(liveAlt(0)).toEqual(A_ALT)
    })
})

describe('a full character written over an archived placeholder restores it first', () => {
    const archivedWorld = () => {
        const full = charWithAlt('hero')
        putUnit('unit-hero', full)
        installDb([stubOf(full, 'unit-hero'), charWithAlt('warm') as unknown as CharacterFixture])
    }

    const copyOfArchived = async () => {
        const copy = await api3().getCharacterFromIndex(0) as Entry
        ;((copy.chats as Entry[])[0].message as Entry[])[0].data = 'edited'
        return copy
    }

    const writers: [string, (copy: Entry) => Promise<void>][] = [
        ['V3 setCharacterToIndex', (copy) => api3().setCharacterToIndex(0, copy)],
        ['V3 setDatabase', (copy) => api3().setDatabase({ characters: [copy, DBState.db.characters[1]] })],
        ['V3 setDatabaseLite', (copy) => api3().setDatabaseLite({ characters: [copy, DBState.db.characters[1]] })],
        ['V3 setChar', (copy) => api3().setChar(copy)],
    ]

    // new-rule guard: before this change the placeholder was overwritten and the archived alternatives were lost
    test.each(writers)('%s', async (_name, write) => {
        archivedWorld()
        const copy = await copyOfArchived()
        await write(copy)
        expect(DBState.db.characters[0].coldstorage).toBeFalsy()
        expect(liveChat(0).message[0].data).toBe('edited')
        expect(liveAlt(0)).toEqual(A_ALT)
    })

    test('a restore that fails rejects and writes nothing', async () => {
        archivedWorld()
        const copy = await copyOfArchived()
        units.delete('unit-hero')
        await expect(api3().setDatabase({ characters: [copy, DBState.db.characters[1]], zzMarker: 'written' })).rejects.toThrow()
        expect(DBState.db.characters[0].coldstorage).toBeTruthy()
        expect((DBState.db.pluginCustomStorage as Entry).zzMarker).toBeUndefined()
        await expect(api3().setCharacterToIndex(0, copy)).rejects.toThrow()
        expect(DBState.db.characters[0].coldstorage).toBeTruthy()
    })

    test('the second of two restores fails: nothing of the plugin\'s data is written', async () => {
        const heroA = charWithAlt('hero-a')
        const heroB = charWithAlt('hero-b')
        putUnit('unit-a', heroA)
        installDb([stubOf(heroA, 'unit-a'), stubOf(heroB, 'unit-b')])
        const copyA = await api3().getCharacterFromIndex(0) as Entry
        const copyB = pluginCopy('hero-b')
        copyA.name = 'plugin edit'
        await expect(api3().setDatabase({ characters: [copyA, copyB], zzMarker: 'written' })).rejects.toThrow()
        expect((DBState.db.pluginCustomStorage as Entry).zzMarker).toBeUndefined()
        expect(DBState.db.characters[0].name).not.toBe('plugin edit')
    })

    test('a target archived again during a later restore refuses the whole write', async () => {
        const heroA = charWithAlt('hero-a')
        const heroB = charWithAlt('hero-b')
        putUnit('unit-a', heroA)
        putUnit('unit-b', heroB)
        const stubA = stubOf(heroA, 'unit-a')
        installDb([stubA, stubOf(heroB, 'unit-b')])
        const copyA = await api3().getCharacterFromIndex(0) as Entry
        const copyB = await api3().getCharacterFromIndex(1) as Entry
        copyA.name = 'plugin edit'
        const reader = readColdStorageItemMock.getMockImplementation()
        readColdStorageItemMock.mockImplementation(async (key: string, ...rest: unknown[]) => {
            const result = await reader?.(key, ...rest)
            if (key === 'unit-b') {
                // The put-back of the first target lands while the second restore waits.
                DBState.db.characters[0] = stubOf(heroA, 'unit-a')
            }
            return result
        })
        await expect(api3().setDatabase({ characters: [copyA, copyB], zzMarker: 'written' })).rejects.toThrow(/archived again/)
        expect((DBState.db.pluginCustomStorage as Entry).zzMarker).toBeUndefined()
        expect(DBState.db.characters[0].coldstorage).toBeTruthy()
    })

    test('setDatabaseLite: a target archived again during a later restore refuses the whole write', async () => {
        const heroA = charWithAlt('hero-a')
        const heroB = charWithAlt('hero-b')
        putUnit('unit-a', heroA)
        putUnit('unit-b', heroB)
        const stubA = stubOf(heroA, 'unit-a')
        installDb([stubA, stubOf(heroB, 'unit-b')])
        const copyA = await api3().getCharacterFromIndex(0) as Entry
        const copyB = await api3().getCharacterFromIndex(1) as Entry
        copyA.name = 'plugin edit'
        const reader = readColdStorageItemMock.getMockImplementation()
        readColdStorageItemMock.mockImplementation(async (key: string, ...rest: unknown[]) => {
            const result = await reader?.(key, ...rest)
            if (key === 'unit-b') {
                // The put-back of the first target lands while the second restore waits.
                DBState.db.characters[0] = stubOf(heroA, 'unit-a')
            }
            return result
        })
        await expect(api3().setDatabaseLite({ characters: [copyA, copyB], zzMarker: 'written' })).rejects.toThrow(/archived again/)
        expect((DBState.db.pluginCustomStorage as Entry).zzMarker).toBeUndefined()
        expect(DBState.db.characters[0].coldstorage).toBeTruthy()
    })
})

describe('the V2 call that cannot wait for a restore', () => {
    test('V2 setChar over a placeholder refuses and writes nothing', async () => {
        const full = charWithAlt('hero')
        putUnit('unit-hero', full)
        installDb([stubOf(full, 'unit-hero')])
        const copy = await api3().getCharacterFromIndex(0) as Entry
        expect(() => api2().setChar(copy)).toThrow(/archived again/)
        expect(DBState.db.characters[0].coldstorage).toBeTruthy()
    })

    test('guard: V2 setDatabaseLite still writes before it returns when nothing needs a restore', () => {
        installTwoWithAlt()
        const returned = api2().setDatabaseLite({ characters: [pluginCopy('a'), pluginCopy('b')] })
        expect(returned).toBeUndefined()
        expect(liveChat(0).message[0].data).toBe('edited')
        expect(liveAlt(0)).toEqual(A_ALT)
    })

    test('V2 setDatabaseLite waits for the restore when a full character goes over a placeholder', async () => {
        const full = charWithAlt('hero')
        putUnit('unit-hero', full)
        installDb([stubOf(full, 'unit-hero')])
        const copy = await api3().getCharacterFromIndex(0) as Entry
        const returned = api2().setDatabaseLite({ characters: [copy] })
        expect(returned).toBeInstanceOf(Promise)
        await returned
        expect(DBState.db.characters[0].coldstorage).toBeFalsy()
        expect(liveAlt(0)).toEqual(A_ALT)
    })
})