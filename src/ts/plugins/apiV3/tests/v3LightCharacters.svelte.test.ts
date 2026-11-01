// @vitest-environment jsdom

/**
 * Fork-specific `getLightCharacters` and the write-back of light entries.
 *
 * Read: the entry carries only what the character lists show, reads no chat or message, restores no archived
 * character and is a fresh plain value (it survives `structuredClone` and one trip through the bridge host).
 * Write: `setDatabase` and `setDatabaseLite` swap each light entry for the live character that holds its `chaId`,
 * so chats, lorebook and alternatives never come from the plugin, and resolve `{ lightKept, lightLeftOut }`. The
 * single-character setters refuse a light entry before any restore, and a light entry that cannot be written
 * (no id, or carrying chats) refuses the whole call before anything is written.
 *
 * Over the REAL `v3.svelte.ts`, `plugins.svelte.ts` and `factory.ts` (the module-mock set of
 * `v3ChatAlt.svelte.test.ts`). Fixtures come from the real producers: `buildColdStub` for placeholders and the
 * chat shape of the chat-alternative bridge. The database is installed as a raw tree, as in that file, not
 * through the app's normaliser. Labels: (R) acceptance of a rule that fails when the rule is broken; (G)
 * compatibility guard that passes before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { flushSync } from 'svelte'
import type { Database, character } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())
/** Whether the stored `'db'` grant exists; the prompt answer is `alertConfirmMock`. */
const grant = vi.hoisted(() => ({ db: true }))
/** Calls of the archived-character restore, which a light entry must never trigger. */
const restores = vi.hoisted(() => ({ calls: 0 }))
const busy = vi.hoisted(() => ({ begun: 0, ended: 0 }))

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                if (options?.name === 'plugin_permissions' && grant.db) {
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

vi.mock('src/ts/process/memory/busyActions', () => ({
    beginChokePoint: vi.fn(() => {
        busy.begun += 1
        return () => { busy.ended += 1 }
    }),
    markPluginPanelHidden: vi.fn(),
    markPluginPanelShown: vi.fn(),
}))

vi.mock(import('../../../process/coldCharacterAccess'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        restoreArchivedForWrite: vi.fn(async (...args: Parameters<typeof original.restoreArchivedForWrite>) => {
            restores.calls++
            return original.restoreArchivedForWrite(...args)
        }),
    } as unknown as typeof import('../../../process/coldCharacterAccess')
})

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
        alertStore: writable({ type: 'none', msg: '' }),
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

vi.mock(import('../../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertPluginConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertErrorWait: vi.fn(async () => {}),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    doingAlert: vi.fn(() => false),
    alertToast: vi.fn(),
    alertWait: vi.fn(() => ({})),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('../../../alert'))

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
import { SandboxHost } from '../factory'
import { getV2PluginAPIs } from '../../plugins.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { buildColdStub } from '../../../process/coldCharacter'
import { withoutAltIn } from '../../chatAltBridge'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type Entry = Record<string, unknown>

const PLUGIN_NAME = 'light-test-plugin'

function makePlugin(): RisuPlugin {
    return {
        name: PLUGIN_NAME,
        script: 'light-characters-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeChat(id: string, text: string, alt?: Entry[]): Entry {
    return { id, message: [{ role: 'user', data: text, time: 1 }], note: '', name: id, localLore: [], ...(alt ? { alt } : {}) }
}

const altRecord = (id: string): Entry => ({ m: { role: 'char', data: id, chatId: id, time: 1 }, p: null, a: 1 })

/** A full character with three chats (the first holds alternatives) and a lorebook entry. */
function fullCharacter(chaId: string | number, extra: Entry = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: `${chaId} notes`,
        creator: `${chaId} creator`,
        tags: ['t1', 't2'],
        lastInteraction: 5000,
        desc: `${chaId} description`,
        globalLore: [{ comment: `${chaId} lore`, content: `${chaId} lore content`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }],
        chats: [makeChat(`${chaId}-chat-0`, 'first', [altRecord(`${chaId}-alt`)]), makeChat(`${chaId}-chat-1`, 'second'), makeChat(`${chaId}-chat-2`, 'third')],
        ...extra,
    } as unknown as character
}

function groupCharacter(chaId: string): character {
    return fullCharacter(chaId, { type: 'group', characters: ['a', 'b'], tags: undefined, creator: undefined })
}

/** The placeholder as it sits in the list after load. */
function stubOf(full: character, key: string): CharacterFixture {
    return buildColdStub(full, key, []) as unknown as CharacterFixture
}

function installDb(characters: Array<character | CharacterFixture>): void {
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

const live = () => DBState.db.characters as unknown as Entry[]
const liveIds = () => live().map((c) => c.chaId)
const frozen = () => JSON.stringify($state.snapshot(DBState.db))
const api2 = () => getV2PluginAPIs()
const api3 = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

async function lightEntries(): Promise<Entry[]> {
    return (await api3().getLightCharacters()) as unknown as Entry[]
}

const LIGHT_KEYS = ['archived', 'chaId', 'chatCount', 'creator', 'creatorNotes', 'image', 'lastInteraction', 'lightEntry', 'name', 'tags', 'type']

//#endregion

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    readColdStorageItemMock.mockImplementation(async () => ({ status: 'missing' }))
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    grant.db = true
    restores.calls = 0
    busy.begun = 0
    busy.ended = 0
    selectedCharID.set(0)
    vi.stubGlobal('ImageBitmap', class {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('getLightCharacters (read)', () => {
    test('(R) T2-1 an entry holds exactly the documented fields, for a character, a group and an archived character', async () => {
        const hero = fullCharacter('hero')
        installDb([fullCharacter('a'), groupCharacter('g'), stubOf(hero, 'unit-hero')])
        const entries = await lightEntries()
        expect(entries).toHaveLength(3)
        expect(Object.keys(entries[0]).sort()).toEqual(LIGHT_KEYS)
        expect(entries[0]).toEqual({
            lightEntry: true, chaId: 'a', name: 'a name', image: 'a.png', type: 'character', creatorNotes: 'a notes',
            tags: ['t1', 't2'], creator: 'a creator', lastInteraction: 5000, chatCount: 3, archived: false,
        })
        expect(Object.keys(entries[1]).sort()).toEqual(['archived', 'chaId', 'characters', 'chatCount', 'creatorNotes', 'image', 'lastInteraction', 'lightEntry', 'name', 'type'])
        expect(entries[1]).toMatchObject({ type: 'group', characters: ['a', 'b'], chatCount: 3, archived: false })
        expect(entries[2]).toMatchObject({ chaId: 'hero', archived: true, chatCount: 3, type: 'character', lightEntry: true })
        for (const entry of entries) {
            expect(entry).not.toHaveProperty('chats')
            expect(entry).not.toHaveProperty('globalLore')
            expect(entry).not.toHaveProperty('coldstorage')
        }
    })

    test('(R) T2-1 every object field is a fresh plain value: structuredClone succeeds and no field is a live reference', async () => {
        installDb([fullCharacter('a'), groupCharacter('g')])
        const entries = await lightEntries()
        expect(() => structuredClone(entries)).not.toThrow()
        expect(entries[0].tags).not.toBe(live()[0].tags)
        expect(entries[1].characters).not.toBe(live()[1].characters)
        ;(entries[0].tags as string[]).push('edited')
        expect(live()[0].tags).toEqual(['t1', 't2'])
    })

    test('(R) T2-1 one call through the bridge host returns the entries', async () => {
        installDb([fullCharacter('a'), groupCharacter('g')])
        const api = api3()
        const host = new SandboxHost({ getLightCharacters: api.getLightCharacters })
        const container = document.createElement('div')
        document.body.appendChild(container)
        if (!('sandbox' in HTMLIFrameElement.prototype)) {
            Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', { configurable: true, get() { return { add() {} } } })
        }
        host.run(container, '')
        const iframe = container.querySelector('iframe') as HTMLIFrameElement
        const win = iframe.contentWindow as Window
        const posted: Entry[] = []
        vi.spyOn(win, 'postMessage').mockImplementation(((message: Entry) => { posted.push(message) }) as unknown as typeof win.postMessage)
        const event = new MessageEvent('message', { data: { type: 'CALL_ROOT', method: 'getLightCharacters', args: [], reqId: 'light-1' } })
        Object.defineProperty(event, 'source', { value: win })
        window.dispatchEvent(event)
        for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
        host.terminate()
        document.body.innerHTML = ''
        const response = posted.find((m) => m.type === 'RESPONSE' && m.reqId === 'light-1')
        expect(response).toBeDefined()
        expect((response?.result as Entry[]).map((e) => e.chaId)).toEqual(['a', 'g'])
    })

    test('(R) T2-2 it reads no message and restores nothing, where getDatabase reads them', async () => {
        const reads = { count: 0 }
        const chat = makeChat('a-chat-0', 'x')
        const message: Entry = { role: 'user', time: 1 }
        Object.defineProperty(message, 'data', { enumerable: true, configurable: true, get() { reads.count++; return 'counted' } })
        chat.message = [message]
        const hero = fullCharacter('hero')
        // The tree enters DBState with the accessor intact, as a loaded save does.
        installDb([fullCharacter('a', { chats: [chat] }), stubOf(hero, 'unit-hero')])
        flushSync()
        reads.count = 0
        await lightEntries()
        expect(reads.count).toBe(0)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(restores.calls).toBe(0)
        await api3().getDatabase(['characters'])
        expect(reads.count).toBeGreaterThan(0)
    })

    test('(R) permission denied resolves null and reads nothing', async () => {
        installDb([fullCharacter('a')])
        grant.db = false
        alertConfirmMock.mockImplementation(async () => false)
        // A plugin the session cache has not seen, so the stored grant (absent now) decides.
        const stranger = makeRisuaiAPIV3({} as HTMLIFrameElement, { ...makePlugin(), name: 'denied-plugin', script: 'denied-script' })
        expect(await stranger.getLightCharacters()).toBeNull()
        expect(alertConfirmMock).toHaveBeenCalled()
    })

    test('(G) T2-10 the default getDatabase output holds no light entry and equals the snapshot of the list', async () => {
        installDb([fullCharacter('a'), groupCharacter('g'), stubOf(fullCharacter('hero'), 'unit-hero')])
        const result = await api3().getDatabase(['characters']) as { characters: unknown[] }
        const expected = $state.snapshot(DBState.db.characters) as unknown as Array<{ chats?: Array<{ alt?: unknown }> }>
        withoutAltIn(expected)
        expect(result.characters).toEqual(expected)
        expect(JSON.stringify(result)).not.toContain('lightEntry')
    })
})

describe('light entries written back', () => {
    function everyCharacter(): Array<character | CharacterFixture> {
        return [
            fullCharacter('a'),
            fullCharacter('b'),
            groupCharacter('g'),
            stubOf(fullCharacter('hero'), 'unit-hero'),
            fullCharacter(7),
            stubOf(fullCharacter(9), 'unit-nine'),
            fullCharacter('config'),
        ]
    }

    test.each(['setDatabase', 'setDatabaseLite'] as const)('(R) T2-3 %s with every entry light keeps each live character as the same object, numeric and held ids included', async (method) => {
        installDb(everyCharacter())
        const before = live().map((c) => c)
        const content = frozen()
        const entries = await lightEntries()
        expect(entries.map((e) => e.chaId)).toEqual(['a', 'b', 'g', 'hero', 7, 9, 'config'])
        const counts = await api3()[method]({ characters: entries })
        expect(counts).toEqual({ lightKept: 7, lightLeftOut: 0 })
        expect(live()).toHaveLength(7)
        live().forEach((c, i) => expect(c).toBe(before[i]))
        expect(frozen()).toBe(content)
        expect(JSON.stringify($state.snapshot(DBState.db))).not.toContain('lightEntry')
        expect(restores.calls).toBe(0)
    })

    test('(R) T2-4 the list follows the plugin: reordered, one omitted, a full entry mixed in with its live alternatives kept', async () => {
        installDb([fullCharacter('a'), fullCharacter('b'), fullCharacter('c'), fullCharacter('d')])
        const [a, , c] = live().map((x) => x)
        const entries = await lightEntries()
        const editedB = $state.snapshot(live()[1]) as unknown as Entry
        withoutAltIn([editedB as { chats?: Array<{ alt?: unknown }> }])
        ;(editedB.chats as Entry[])[0].message = [{ role: 'user', data: 'edited', time: 1 }]
        const counts = await api3().setDatabase({ characters: [entries[2], editedB, entries[0]] })
        expect(counts).toEqual({ lightKept: 2, lightLeftOut: 0 })
        expect(liveIds()).toEqual(['c', 'b', 'a'])
        expect(live()[0]).toBe(c)
        expect(live()[2]).toBe(a)
        const chat = (live()[1].chats as Entry[])[0]
        expect((chat.message as Entry[])[0].data).toBe('edited')
        expect(chat.alt).toEqual([altRecord('b-alt')])
    })

    test('(R) T2-5 two live holders of one id: two entries map to both, one entry to the first, never one holder twice', async () => {
        installDb([fullCharacter('dup', { name: 'one' }), fullCharacter('dup', { name: 'two' })])
        const [first, second] = live().map((x) => x)
        const entries = await lightEntries()
        expect(entries.map((e) => e.name)).toEqual(['one', 'two'])
        await api3().setDatabase({ characters: [entries[0], entries[1]] })
        expect(live().map((x) => x)).toEqual([first, second])
        expect(live()[0]).toBe(first)
        expect(live()[1]).toBe(second)
        await api3().setDatabase({ characters: [entries[1], entries[0]] })
        expect(live()[0]).toBe(first)
        expect(live()[1]).toBe(second)
        const counts = await api3().setDatabase({ characters: [entries[1]] })
        expect(counts).toEqual({ lightKept: 1, lightLeftOut: 0 })
        expect(live()).toHaveLength(1)
        expect(live()[0]).toBe(first)
    })

    test('(R) T2-6 a holder deleted after the read leaves its entry out, and edited light fields are ignored', async () => {
        installDb([fullCharacter('a'), fullCharacter('b')])
        const a = live()[0]
        const entries = await lightEntries()
        DBState.db.characters = [DBState.db.characters[0]]
        entries[0].name = 'renamed by the plugin'
        entries[0].archived = true
        const counts = await api3().setDatabase({ characters: entries })
        expect(counts).toEqual({ lightKept: 1, lightLeftOut: 1 })
        expect(liveIds()).toEqual(['a'])
        expect(live()[0]).toBe(a)
        expect(live()[0].name).toBe('a name')
        expect(live()[0].coldstorage).toBeUndefined()
    })

    test.each(['setDatabase', 'setDatabaseLite'] as const)('(R) T2-6b %s resolves the counts of its own call, zeros without light entries, and rejects a refused call', async (method) => {
        installDb([fullCharacter('a'), fullCharacter('b')])
        const entries = await lightEntries()
        DBState.db.characters = [DBState.db.characters[0]]
        const counts = await api3()[method]({ characters: [entries[0], entries[1], fullCharacter('c')] })
        expect(counts).toEqual({ lightKept: 1, lightLeftOut: 1 })
        expect(liveIds()).toEqual(['a', 'c'])
        // The next call reports its own numbers, not the previous call's.
        expect(await api3()[method]({ pluginKey: 1 })).toEqual({ lightKept: 0, lightLeftOut: 0 })
        const refused = api3()[method]({ characters: [{ lightEntry: true, name: 'no id' }] })
        await expect(refused).rejects.toThrow()
    })

    test('(G) T2-6b the V2 setDatabase still resolves undefined', async () => {
        installDb([fullCharacter('a'), fullCharacter('b')])
        await expect(api2().setDatabase({ pluginKey: 1 })).resolves.toBeUndefined()
        await expect(Promise.resolve(api2().setDatabaseLite({ pluginKey: 1 }))).resolves.toBeUndefined()
    })

    test.each(['setDatabase', 'setDatabaseLite'] as const)('(R) T2-8 %s with a light entry for a character archived since the read restores nothing and keeps the placeholder', async (method) => {
        installDb([fullCharacter('a'), fullCharacter('b')])
        const entries = await lightEntries()
        const stub = stubOf(fullCharacter('a'), 'unit-a')
        DBState.db.characters[0] = stub
        const held = live()[0]
        const counts = await api3()[method]({ characters: entries })
        expect(counts).toEqual({ lightKept: 2, lightLeftOut: 0 })
        expect(restores.calls).toBe(0)
        expect(live()[0]).toBe(held)
        expect(live()[0].coldstorage).toBe('unit-a')
    })

    test.each(['setDatabase', 'setDatabaseLite'] as const)('(R) T2-9 %s refuses a light entry without an id before anything is written', async (method) => {
        installDb([fullCharacter('a')])
        const entries = await lightEntries()
        const content = frozen()
        const noId = { ...entries[0] }
        delete noId.chaId
        await expect(api3()[method]({ characters: [noId], laterKey: 5 })).rejects.toThrow()
        expect(frozen()).toBe(content)
    })

    test.each([
        ['setDatabase', false],
        ['setDatabaseLite', false],
        ['setDatabase', true],
        ['setDatabaseLite', true],
    ] as const)('(R) T2-11 %s refuses a light entry that carries chats (live holder archived: %s)', async (method, archived) => {
        installDb([archived ? stubOf(fullCharacter('a'), 'unit-a') : fullCharacter('a'), fullCharacter('b')])
        const entries = await lightEntries()
        const content = frozen()
        const withChats = { ...entries[0], chats: [] }
        await expect(api3()[method]({ characters: [withChats, entries[1]], laterKey: 5 })).rejects.toThrow(/getCharacterFromIndex/)
        expect(frozen()).toBe(content)
        expect(restores.calls).toBe(0)
        const noHolder = { ...entries[0], chaId: 'nobody', chats: [] }
        await expect(api3()[method]({ characters: [noHolder], laterKey: 5 })).rejects.toThrow(/getCharacterFromIndex/)
        expect(frozen()).toBe(content)
    })
})

describe('single-character setters refuse a light entry', () => {
    async function lightOf(chaId: string): Promise<Entry> {
        return (await lightEntries()).find((e) => e.chaId === chaId) as Entry
    }

    test('(R) T2-7 setChar, setCharacter and setCharacterToIndex reject, write nothing and restore nothing, over a resident and an archived slot', async () => {
        installDb([fullCharacter('a'), stubOf(fullCharacter('hero'), 'unit-hero')])
        const content = frozen()
        const resident = await lightOf('a')
        const archived = await lightOf('hero')
        selectedCharID.set(1)
        await expect(api3().setChar(archived)).rejects.toThrow(/light/i)
        await expect(api3().setCharacter(archived)).rejects.toThrow(/light/i)
        await expect(api3().setCharacterToIndex(1, archived)).rejects.toThrow(/light/i)
        selectedCharID.set(0)
        await expect(api3().setChar(resident)).rejects.toThrow(/light/i)
        await expect(api3().setCharacterToIndex(0, resident)).rejects.toThrow(/light/i)
        expect(frozen()).toBe(content)
        expect(restores.calls).toBe(0)
    })

    test('(R) T2-7 the V2 setChar refuses a light entry too', async () => {
        installDb([fullCharacter('a')])
        const content = frozen()
        const resident = await lightOf('a')
        expect(() => api2().setChar(resident)).toThrow(/light/i)
        expect(frozen()).toBe(content)
    })
})
